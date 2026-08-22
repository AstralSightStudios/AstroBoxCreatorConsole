use anyhow::Context;
use chrono::Local;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const RESOURCE_LOG_DIR_NAME: &str = "resource";
const SESSION_RETENTION_DAYS: i64 = 30;
const LOG_FILE_SUFFIX: &str = ".log";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceLogSession {
    pub file_name: String,
}

fn resource_log_dir<R: Runtime>(app_handle: &AppHandle<R>) -> anyhow::Result<PathBuf> {
    let dir = app_handle
        .path()
        .app_log_dir()
        .context("failed to resolve app log directory")?
        .join(RESOURCE_LOG_DIR_NAME);
    fs::create_dir_all(&dir).with_context(|| {
        format!(
            "failed to create resource log directory at {}",
            dir.display()
        )
    })?;
    Ok(dir)
}

/// Session file names are generated here and echoed back by the frontend on
/// every write, so validate strictly to prevent path traversal.
fn sanitize_session_file_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if !trimmed.ends_with(LOG_FILE_SUFFIX) || trimmed.len() > 96 {
        return None;
    }
    let stem = &trimmed[..trimmed.len() - LOG_FILE_SUFFIX.len()];
    let valid = !stem.is_empty()
        && stem
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '_' | '-'));
    valid.then(|| trimmed.to_string())
}

/// Remove session logs older than the retention window (based on file mtime).
fn cleanup_old_sessions(dir: &PathBuf) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(
        // u64 seconds; retention is always positive.
        (SESSION_RETENTION_DAYS.max(1) * 24 * 60 * 60) as u64,
    );
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let expired = metadata
            .modified()
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if expired {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Start a new resource flow session: creates `{mode}_{timestamp}_{id}.log`
/// under `app_log_dir()/resource/`, writes the provided header lines and
/// returns the generated file name. A new session is started every time the
/// user enters the publish/edit wizard, regardless of whether a PR eventually
/// exists.
#[tauri::command]
pub async fn resource_log_start<R: Runtime>(
    app_handle: AppHandle<R>,
    mode: String,
    header_lines: Vec<String>,
) -> Result<ResourceLogSession, String> {
    let mode_stem: String = {
        let sanitized: String = mode
            .trim()
            .to_ascii_lowercase()
            .chars()
            .filter(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
            .take(24)
            .collect();
        if sanitized.is_empty() {
            "session".to_string()
        } else {
            sanitized
        }
    };

    let dir = resource_log_dir(&app_handle).map_err(|err| err.to_string())?;
    cleanup_old_sessions(&dir);

    let timestamp = Local::now().format("%Y%m%d-%H%M%S");
    let unique = unique_suffix();
    let file_name = format!("{mode_stem}_{timestamp}_{unique}{LOG_FILE_SUFFIX}");

    let path = dir.join(&file_name);
    let mut file = OpenOptions::new()
        .append(true)
        .create_new(true)
        .open(&path)
        .map_err(|err| format!("failed to create session log {file_name}: {err}"))?;

    for line in &header_lines {
        let _ = writeln!(file, "{line}");
    }
    let _ = file.flush();

    Ok(ResourceLogSession { file_name })
}

/// Append pre-formatted single-line entries to an existing session log.
#[tauri::command]
pub async fn resource_log_write<R: Runtime>(
    app_handle: AppHandle<R>,
    file_name: String,
    lines: Vec<String>,
) -> Result<(), String> {
    let safe_name =
        sanitize_session_file_name(&file_name).ok_or_else(|| "invalid session file name".to_string())?;
    if lines.is_empty() {
        return Ok(());
    }

    let dir = resource_log_dir(&app_handle).map_err(|err| err.to_string())?;
    let path = dir.join(safe_name);
    let result: std::io::Result<()> = (|| {
        let mut file = OpenOptions::new().append(true).open(&path)?;
        for line in &lines {
            writeln!(file, "{line}")?;
        }
        file.flush()
    })();
    result.map_err(|err| format!("failed to append session log: {err}"))
}

/// Short per-process unique hex suffix; combined with a second-precision
/// timestamp this avoids collisions between consecutive sessions.
fn unique_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.subsec_nanos() as usize ^ value.as_secs() as usize)
        .unwrap_or(0);
    let pid = std::process::id() as usize;
    let mixed = nanos.rotate_left(17) ^ pid.wrapping_mul(0x9E37_79B9);
    format!("{mixed:08x}")
}

#[cfg(test)]
mod tests {
    use super::sanitize_session_file_name;
    use crate::logger::mask_secret;

    #[test]
    fn sanitizes_session_names() {
        assert_eq!(
            sanitize_session_file_name("publish_20260822-103000_ab12cd34.log").as_deref(),
            Some("publish_20260822-103000_ab12cd34.log")
        );
        assert!(sanitize_session_file_name("../evil.log").is_none());
        assert!(sanitize_session_file_name("no-ext").is_none());
        assert!(sanitize_session_file_name("UPPER.log").is_none());
        assert!(sanitize_session_file_name("sub/dir.log").is_none());
    }

    #[test]
    fn masks_secrets() {
        assert_eq!(mask_secret("Ab3dEfGh12345678w9Xz"), "Ab3d****w9Xz");
        assert_eq!(mask_secret("short"), "*****");
    }
}
