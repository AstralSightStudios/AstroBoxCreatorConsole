use anyhow::Context;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tar::Builder;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLogsResult {
    pub saved_path: String,
    pub file_size: u64,
}

/// Bundle the whole log directory (daily logs + resource sessions) plus a
/// diagnostics file with build/device info into a single `.tar.gz` and write
/// it to `target_path` (chosen by the user through the save dialog).
#[tauri::command]
pub async fn export_logs_archive<R: Runtime>(
    app_handle: AppHandle<R>,
    target_path: String,
    notes: Option<String>,
) -> Result<ExportLogsResult, String> {
    let archive = build_archive(&app_handle, notes.as_deref()).map_err(|err| err.to_string())?;

    let target = PathBuf::from(target_path.trim());
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| format!("failed to create directory: {err}"))?;
        }
    }
    fs::write(&target, &archive)
        .map_err(|err| format!("failed to write archive to {}: {err}", target.display()))?;
    let file_size = archive.len() as u64;

    Ok(ExportLogsResult {
        saved_path: target.to_string_lossy().into_owned(),
        file_size,
    })
}

fn log_dir<R: Runtime>(app_handle: &AppHandle<R>) -> anyhow::Result<PathBuf> {
    let dir = app_handle
        .path()
        .app_log_dir()
        .context("failed to resolve app log directory")?;
    Ok(dir)
}

fn build_diagnostics(notes: Option<&str>) -> String {
    let info = os_info::get();
    let mut lines: Vec<String> = Vec::new();

    lines.push("=== AstroBox CreatorConsole 诊断信息 / Diagnostics ===".to_string());
    lines.push(format!("生成时间: {}", chrono::Local::now().to_rfc3339()));
    lines.push(String::new());
    lines.push("--- 构建信息 / Build ---".to_string());
    lines.push(format!("应用版本: {}", env!("CARGO_PKG_VERSION")));
    lines.push(format!(
        "构建模式: {}",
        if cfg!(debug_assertions) { "debug" } else { "release" }
    ));
    lines.push(format!("Tauri 版本: {}", tauri::VERSION));
    lines.push(String::new());
    lines.push("--- 设备信息 / Device ---".to_string());
    lines.push(format!(
        "操作系统: {} {} ({})",
        info.os_type(),
        info.version(),
        info.bitness()
    ));
    match info.architecture() {
        Some(arch) => lines.push(format!("架构: {arch}")),
        None => lines.push(format!("架构: {}", std::env::consts::ARCH)),
    }
    lines.push(format!(
        "系统区域: {}",
        sys_locale::get_locale().unwrap_or_else(|| "unknown".to_string())
    ));

    if let Some(notes) = notes.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(String::new());
        lines.push("--- 用户备注 / Notes ---".to_string());
        for line in notes.lines().take(40) {
            // Keep the diagnostics file single-purpose and small; strip anything
            // that looks like a credential just in case.
            lines.push(crate::logger::redact_sensitive(line.to_string()));
        }
    }

    lines.join("\n")
}

fn build_archive<R: Runtime>(
    app_handle: &AppHandle<R>,
    notes: Option<&str>,
) -> anyhow::Result<Vec<u8>> {
    let source_dir = log_dir(app_handle)?;
    if !source_dir.exists() {
        fs::create_dir_all(&source_dir)?;
    }

    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar = Builder::new(encoder);

    let diagnostics = build_diagnostics(notes);
    let mut header = tar::Header::new_gnu();
    header.set_size(diagnostics.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append_data(&mut header, "diagnostics.txt", diagnostics.as_bytes())
        .context("failed to append diagnostics into archive")?;

    tar.append_dir_all("logs", &source_dir)
        .with_context(|| format!("failed to archive {}", source_dir.display()))?;

    let encoder = tar.into_inner()?;
    Ok(encoder.finish()?)
}
