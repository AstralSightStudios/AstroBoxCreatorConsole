use anyhow::Context;
use chrono::{Days, Local, NaiveDate};
use log::LevelFilter;
use regex::Regex;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{self, WEBVIEW_TARGET};

const LOG_RETENTION_DAYS: i64 = 7;
const LOG_DATE_FORMAT: &str = "%Y-%m-%d";
const LOG_TIME_FORMAT: &str = "%Y-%m-%d %H:%M:%S%.3f";
const LOG_FILE_SUFFIX: &str = ".log";
const LOG_FILE_PREFIX_FALLBACK: &str = "astroboxcc";

/// Mask the middle of a secret-like value: keep first/last 4 chars when long
/// enough, otherwise replace everything with asterisks.
pub fn mask_secret(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 12 {
        return "*".repeat(chars.len().max(1));
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}****{tail}")
}

/// Mask the tail of a credential-like value: keep only the last 4 chars,
/// mirroring the frontend `maskCredential` behavior.
pub fn mask_credential(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 8 {
        return "*".repeat(chars.len().max(1));
    }
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("****{tail}")
}

/// Best-effort scrubbing of well-known credential patterns so that tokens
/// never reach the log file even if a call site forgets to redact.
pub fn redact_sensitive(message: String) -> String {
    static PATTERNS: Mutex<Option<Vec<Regex>>> = Mutex::new(None);
    static KEY_VALUE_PATTERN: Mutex<Option<Regex>> = Mutex::new(None);
    let mut guard = match PATTERNS.lock() {
        Ok(guard) => guard,
        Err(_) => return message,
    };
    if guard.is_none() {
        *guard = Some(
            [
                r"gh[posur]_[A-Za-z0-9]{16,}",
                r"github_pat_[A-Za-z0-9_]{20,}",
                r"(?i:bearer)\s+[A-Za-z0-9._~+/=-]{8,}",
                r"\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){0,2}",
            ]
            .into_iter()
            .filter_map(|pattern| Regex::new(pattern).ok())
            .collect(),
        );
        if let Ok(regex) = Regex::new(
            r#"(?i)("[^"]*(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|authorization|api[_-]?key)\b[^"]*"\s*:\s*")([A-Za-z0-9._~+/=-]{12,})(")"#,
        ) {
            if let Ok(mut key_value_guard) = KEY_VALUE_PATTERN.lock() {
                *key_value_guard = Some(regex);
            }
        }
    }
    let Some(patterns) = guard.as_ref() else {
        return message;
    };
    let mut result = message;

    // 引号包裹的凭据键值对：`"token":"..."`、`"refreshToken":"eyJ..."`、
    // `"oAuth_GitHub_accessToken":"ghu_..."` 等；值整体只留末 4 位。
    if let Ok(key_value_guard) = KEY_VALUE_PATTERN.lock() {
        if let Some(key_value) = key_value_guard.as_ref() {
            result = key_value
                .replace_all(&result, |caps: &regex::Captures| {
                    let value = caps.get(2).map(|m| m.as_str()).unwrap_or_default();
                    format!("{}{}{}", &caps[1], mask_credential(value), &caps[3])
                })
                .into_owned();
        }
    }

    for pattern in patterns {
        result = pattern
            .replace_all(&result, |caps: &regex::Captures| {
                let matched = caps.get(0).map(|m| m.as_str()).unwrap_or_default();
                // Keep the scheme prefix readable (e.g. "Bearer ") and mask only
                // the secret part.
                let split = matched
                    .char_indices()
                    .find(|(_, ch)| ch.is_ascii_alphanumeric())
                    .map(|(idx, _)| idx)
                    .unwrap_or(0);
                let (prefix, secret) = matched.split_at(split);
                format!("{prefix}{}", mask_secret(secret))
            })
            .into_owned();
    }
    result
}

pub fn init_logger<R: Runtime>(app_handle: &AppHandle<R>) -> anyhow::Result<()> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .context("failed to resolve app log directory")?;
    let file_prefix = sanitize_log_prefix(&app_handle.package_info().name);
    let writer = DailyLogWriter::new(log_dir, file_prefix, LOG_RETENTION_DAYS)?;

    let writer_target = writer.clone();
    let default_level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };

    let dispatch = tauri_plugin_log::fern::Dispatch::new()
        .format(|out, message, record| {
            let ts = Local::now().format(LOG_TIME_FORMAT);
            let msg = redact_sensitive(message.to_string());
            out.finish(format_args!(
                "[{}][{}][{}] {}",
                ts,
                record.level(),
                record.target(),
                msg
            ));
        })
        .level(default_level)
        .level_for(WEBVIEW_TARGET, LevelFilter::Trace)
        .chain(tauri_plugin_log::fern::Output::call(move |record| {
            let message = redact_sensitive(record.args().to_string());
            writer_target.write_line(&message);
        }));

    #[cfg(desktop)]
    let dispatch = dispatch.chain(std::io::stdout());

    let (max_level, logger) = dispatch.into_log();
    tauri_plugin_log::attach_logger(max_level, logger).context("failed to attach global logger")?;
    Ok(())
}

#[derive(Clone)]
struct DailyLogWriter {
    state: Arc<Mutex<DailyLogState>>,
}

struct DailyLogState {
    dir: PathBuf,
    file_prefix: String,
    keep_days: i64,
    current_date: String,
    file: File,
}

impl DailyLogWriter {
    fn new(dir: PathBuf, file_prefix: String, keep_days: i64) -> anyhow::Result<Self> {
        fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create log directory at {}", dir.display()))?;
        let current_date = current_date_string();
        cleanup_old_logs(&dir, &file_prefix, keep_days, &current_date)?;
        let file = open_log_file(&dir, &file_prefix, &current_date)?;

        Ok(Self {
            state: Arc::new(Mutex::new(DailyLogState {
                dir,
                file_prefix,
                keep_days: keep_days.max(1),
                current_date,
                file,
            })),
        })
    }

    fn write_line(&self, line: &str) {
        let mut guard = match self.state.lock() {
            Ok(guard) => guard,
            Err(_) => {
                eprintln!("[logger] failed to acquire daily log writer lock");
                return;
            }
        };
        if let Err(err) = guard
            .rotate_if_needed()
            .and_then(|_| guard.write_line(line))
        {
            eprintln!("[logger] failed to write log line: {err}");
        }
    }
}

impl DailyLogState {
    fn rotate_if_needed(&mut self) -> std::io::Result<()> {
        let current_date = current_date_string();
        if self.current_date == current_date {
            return Ok(());
        }

        cleanup_old_logs(&self.dir, &self.file_prefix, self.keep_days, &current_date)?;
        self.file = open_log_file(&self.dir, &self.file_prefix, &current_date)?;
        self.current_date = current_date;
        Ok(())
    }

    fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        writeln!(self.file, "{line}")?;
        self.file.flush()
    }
}

fn current_date_string() -> String {
    Local::now().format(LOG_DATE_FORMAT).to_string()
}

fn sanitize_log_prefix(raw: &str) -> String {
    let mut normalized = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            normalized.push(ch);
        } else {
            normalized.push('_');
        }
    }

    let trimmed = normalized.trim_matches('_');
    if trimmed.is_empty() {
        LOG_FILE_PREFIX_FALLBACK.to_string()
    } else {
        trimmed.to_string()
    }
}

fn open_log_file(dir: &Path, file_prefix: &str, date: &str) -> std::io::Result<File> {
    let path = dir.join(format!("{file_prefix}_{date}{LOG_FILE_SUFFIX}"));
    OpenOptions::new().append(true).create(true).open(path)
}

fn cleanup_old_logs(
    dir: &Path,
    file_prefix: &str,
    keep_days: i64,
    current_date: &str,
) -> std::io::Result<()> {
    let keep_days = keep_days.max(1);
    let Ok(today) = NaiveDate::parse_from_str(current_date, LOG_DATE_FORMAT) else {
        return Ok(());
    };
    let Some(cutoff) = today.checked_sub_days(Days::new((keep_days - 1) as u64)) else {
        return Ok(());
    };

    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else {
            continue;
        };
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        let Some(date_part) = extract_log_date(&file_name, file_prefix) else {
            continue;
        };
        let Ok(file_date) = NaiveDate::parse_from_str(date_part, LOG_DATE_FORMAT) else {
            continue;
        };

        if file_date < cutoff {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

fn extract_log_date<'a>(file_name: &'a str, file_prefix: &str) -> Option<&'a str> {
    file_name
        .strip_prefix(file_prefix)
        .and_then(|rest| rest.strip_prefix('_'))
        .and_then(|rest| rest.strip_suffix(LOG_FILE_SUFFIX))
}

const FRONTEND_LOG_TARGET_PREFIX: &str = "webview.";

/// Entry point for frontend logs. The WebView bridge forwards every console
/// output here; messages are recorded with the standard webview target so they
/// flow through the same pipeline (file + stdout).
#[tauri::command]
pub fn frontend_log(level: String, target: Option<String>, message: String) {
    let level = match level.as_str() {
        "trace" => log::Level::Trace,
        "debug" => log::Level::Debug,
        "warn" => log::Level::Warn,
        "error" => log::Level::Error,
        _ => log::Level::Info,
    };

    let safe_target = target
        .as_deref()
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 96
                && value
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/'))
        })
        .map(|value| format!("{FRONTEND_LOG_TARGET_PREFIX}{value}"))
        .unwrap_or_else(|| WEBVIEW_TARGET.to_string());

    log::log!(target: &safe_target, level, "{}", redact_sensitive(message));
}
