use anyhow::Context;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tar::Builder;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDiagnostics {
    pub user_agent: Option<String>,
    pub platform: Option<String>,
    pub language: Option<String>,
    pub languages: Option<Vec<String>>,
    pub timezone: Option<String>,
    pub screen: Option<ClientScreenInfo>,
    pub viewport: Option<ClientViewportInfo>,
    pub hardware_concurrency: Option<u32>,
    pub device_memory: Option<f64>,
    pub max_touch_points: Option<u32>,
    pub online: Option<bool>,
    pub connection: Option<ClientConnectionInfo>,
    pub tauri: bool,
    pub probe_urls: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientScreenInfo {
    pub width: u32,
    pub height: u32,
    pub avail_width: u32,
    pub avail_height: u32,
    pub color_depth: u32,
    pub pixel_ratio: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientViewportInfo {
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConnectionInfo {
    pub effective_type: Option<String>,
    pub downlink: Option<f64>,
    pub rtt: Option<u32>,
    pub save_data: Option<bool>,
}

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
    client_diagnostics: Option<ClientDiagnostics>,
) -> Result<ExportLogsResult, String> {
    let probes = probe_network(
        client_diagnostics
            .as_ref()
            .and_then(|client| client.probe_urls.clone()),
    )
    .await;
    let archive =
        build_archive(&app_handle, notes.as_deref(), client_diagnostics.as_ref(), &probes)
            .map_err(|err| err.to_string())?;

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

struct NetworkProbe {
    url: String,
    status: u16,
    latency_ms: u128,
    error: Option<String>,
}

async fn probe_network(urls: Option<Vec<String>>) -> Vec<NetworkProbe> {
    let Some(urls) = urls else {
        return Vec::new();
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("AstroBoxCreatorConsole/Diagnostics")
        .build()
        .ok();
    let mut probes = Vec::new();
    for url in urls.iter().take(8) {
        let started = std::time::Instant::now();
        let url = url.trim().to_string();
        if url.is_empty() {
            continue;
        }
        match &client {
            Some(client) => match client.head(&url).send().await {
                Ok(response) => probes.push(NetworkProbe {
                    url,
                    status: response.status().as_u16(),
                    latency_ms: started.elapsed().as_millis(),
                    error: None,
                }),
                Err(err) => probes.push(NetworkProbe {
                    url,
                    status: 0,
                    latency_ms: started.elapsed().as_millis(),
                    error: Some(err.to_string()),
                }),
            },
            None => probes.push(NetworkProbe {
                url,
                status: 0,
                latency_ms: 0,
                error: Some("HTTP client 初始化失败".to_string()),
            }),
        }
    }
    probes
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value = bytes as f64;
    if value >= GB {
        format!("{:.2} GB", value / GB)
    } else if value >= MB {
        format!("{:.1} MB", value / MB)
    } else if value >= KB {
        format!("{:.0} KB", value / KB)
    } else {
        format!("{bytes} B")
    }
}

fn build_diagnostics(
    notes: Option<&str>,
    client: Option<&ClientDiagnostics>,
    probes: &[NetworkProbe],
) -> String {
    let info = os_info::get();
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    let mut lines: Vec<String> = Vec::new();

    lines.push("=== AstroBox CreatorConsole 诊断信息 / Diagnostics ===".to_string());
    lines.push(format!("生成时间: {}", chrono::Local::now().to_rfc3339()));
    lines.push(String::new());
    lines.push("--- 构建信息 / Build ---".to_string());
    lines.push(format!("应用名称: {}", env!("CARGO_PKG_NAME")));
    lines.push(format!("应用版本: {}", env!("CARGO_PKG_VERSION")));
    lines.push(format!(
        "构建时间: {}",
        crate::buildinfo::BuildInfo::BUILD_TIME
    ));
    lines.push(format!(
        "提交哈希: {}",
        crate::buildinfo::BuildInfo::GIT_COMMIT_HASH
    ));
    lines.push(format!(
        "构建用户: {}",
        crate::buildinfo::BuildInfo::BUILD_USER
    ));
    lines.push(format!(
        "构建模式: {}",
        if cfg!(debug_assertions) { "debug" } else { "release" }
    ));
    lines.push(format!("Tauri 版本: {}", tauri::VERSION));
    lines.push(String::new());
    lines.push("--- 系统信息 / System ---".to_string());
    if let Some(hostname) = sysinfo::System::host_name() {
        lines.push(format!("主机名: {hostname}"));
    }
    lines.push(format!(
        "操作系统: {} {} ({})",
        info.os_type(),
        info.version(),
        info.bitness()
    ));
    if let Some(kernel) = sysinfo::System::kernel_version() {
        lines.push(format!("内核版本: {kernel}"));
    }
    if let Some(os_version) = sysinfo::System::os_version() {
        lines.push(format!("系统版本: {os_version}"));
    }
    if let Some(long_os) = sysinfo::System::long_os_version() {
        lines.push(format!("系统全称: {long_os}"));
    }
    match info.architecture() {
        Some(arch) => lines.push(format!("架构: {arch}")),
        None => lines.push(format!("架构: {}", std::env::consts::ARCH)),
    }
    lines.push(format!("运行时: {} {}", std::env::consts::OS, std::env::consts::ARCH));
    lines.push(format!(
        "系统区域: {}",
        sys_locale::get_locale().unwrap_or_else(|| "unknown".to_string())
    ));
    lines.push(String::new());
    lines.push("--- 硬件信息 / Hardware ---".to_string());
    let cpus = sys.cpus();
    if !cpus.is_empty() {
        lines.push(format!("CPU 型号: {}", cpus[0].brand()));
        lines.push(format!("CPU 逻辑核心: {}", cpus.len()));
        if let Some(physical) = sys.physical_core_count() {
            lines.push(format!("CPU 物理核心: {physical}"));
        }
        lines.push(format!("CPU 频率: {} MHz", cpus[0].frequency()));
    }
    lines.push(format!("内存总量: {}", format_bytes(sys.total_memory())));
    lines.push(format!("内存可用: {}", format_bytes(sys.available_memory())));
    lines.push(format!(
        "内存使用率: {:.1}%",
        sys.used_memory() as f64 * 100.0 / sys.total_memory().max(1) as f64
    ));
    let disks = sysinfo::Disks::new_with_refreshed_list();
    for disk in disks.iter().take(5) {
        lines.push(format!(
            "磁盘 {} ({}): 总量 {}, 可用 {}",
            disk.name().to_string_lossy(),
            disk.mount_point().display(),
            format_bytes(disk.total_space()),
            format_bytes(disk.available_space()),
        ));
    }
    lines.push(String::new());
    lines.push("--- 客户端信息 / Client ---".to_string());
    if let Some(client) = client {
        if let Some(value) = &client.user_agent {
            lines.push(format!("User-Agent: {value}"));
        }
        if let Some(value) = &client.platform {
            lines.push(format!("平台: {value}"));
        }
        if let Some(value) = &client.language {
            lines.push(format!("语言: {value}"));
        }
        if let Some(languages) = &client.languages {
            if !languages.is_empty() {
                lines.push(format!("语言列表: {}", languages.join(", ")));
            }
        }
        if let Some(value) = &client.timezone {
            lines.push(format!("时区: {value}"));
        }
        if let Some(screen) = &client.screen {
            lines.push(format!(
                "屏幕: {}x{}（可用 {}x{}，色深 {}, 缩放 {:.2}）",
                screen.width,
                screen.height,
                screen.avail_width,
                screen.avail_height,
                screen.color_depth,
                screen.pixel_ratio
            ));
        }
        if let Some(viewport) = &client.viewport {
            lines.push(format!("视口: {}x{}", viewport.width, viewport.height));
        }
        if let Some(value) = client.hardware_concurrency {
            lines.push(format!("逻辑处理器(前端): {value}"));
        }
        if let Some(value) = client.device_memory {
            lines.push(format!("设备内存(前端): {value} GB"));
        }
        if let Some(value) = client.max_touch_points {
            lines.push(format!("最大触控点: {value}"));
        }
        if let Some(value) = client.online {
            lines.push(format!("网络在线: {value}"));
        }
        if let Some(connection) = &client.connection {
            lines.push(format!(
                "网络连接: 类型 {}, 下行 {} Mb/s, RTT {} ms, 省流量 {}",
                connection.effective_type.as_deref().unwrap_or("unknown"),
                connection.downlink.map(|v| v.to_string()).unwrap_or_else(|| "-".into()),
                connection.rtt.map(|v| v.to_string()).unwrap_or_else(|| "-".into()),
                connection.save_data.map(|v| v.to_string()).unwrap_or_else(|| "-".into()),
            ));
        }
        lines.push(format!("Tauri 运行环境: {}", client.tauri));
    } else {
        lines.push("客户端诊断信息不可用".to_string());
    }
    lines.push(String::new());
    lines.push("--- 网络探测 / Network ---".to_string());
    if probes.is_empty() {
        lines.push("未提供探测地址".to_string());
    }
    for probe in probes {
        match probe.status {
            0 => lines.push(format!(
                "{} → 连接失败 ({} ms): {}",
                probe.url,
                probe.latency_ms,
                probe.error.as_deref().unwrap_or("unknown")
            )),
            status => lines.push(format!(
                "{} → HTTP {status} ({} ms)",
                probe.url, probe.latency_ms
            )),
        }
    }

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
    client: Option<&ClientDiagnostics>,
    probes: &[NetworkProbe],
) -> anyhow::Result<Vec<u8>> {
    let source_dir = log_dir(app_handle)?;
    if !source_dir.exists() {
        fs::create_dir_all(&source_dir)?;
    }

    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar = Builder::new(encoder);

    let diagnostics = build_diagnostics(notes, client, probes);
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
