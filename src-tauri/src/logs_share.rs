use anyhow::Context;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tar::Builder;
use tauri::{AppHandle, Manager, Runtime};

const SHARE_CACHE_MAX_AGE: Duration = Duration::from_secs(60 * 60 * 24);

/// 移动端无法像桌面那样通过系统文件管理器直接打开应用私有目录，因此日志包
/// 先在内存里打成 tar.gz 并 base64 编码回传前端，再由原生分享面板导出。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogArchivePayload {
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct PreparedShareFile {
    path: PathBuf,
    file_name: String,
    mime_type: String,
}

/// 把整个日志目录（每日运行日志 + resource 会话记录）打包成 tar.gz，
/// 返回 base64 载荷供移动端通过系统分享导出。
#[tauri::command]
pub async fn prepare_logs_archive<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<LogArchivePayload, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .context("failed to resolve app log directory")
        .map_err(|err| err.to_string())?;
    fs::create_dir_all(&log_dir)
        .with_context(|| format!("failed to create log directory at {}", log_dir.display()))
        .map_err(|err| err.to_string())?;

    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar = Builder::new(encoder);
    tar.append_dir_all("logs", &log_dir)
        .with_context(|| format!("failed to archive log directory at {}", log_dir.display()))
        .map_err(|err| err.to_string())?;
    let encoder = tar
        .into_inner()
        .context("failed to finalize log tar archive")
        .map_err(|err| err.to_string())?;
    let archive_bytes = encoder
        .finish()
        .context("failed to finalize log gzip stream")
        .map_err(|err| err.to_string())?;

    Ok(LogArchivePayload {
        file_name: build_logs_archive_name(),
        mime_type: "application/gzip".to_string(),
        data_base64: BASE64_STANDARD.encode(archive_bytes),
    })
}

/// 把 base64 载荷落盘到应用缓存目录，再拉起系统原生分享。
#[tauri::command]
pub async fn share_logs_archive<R: Runtime>(
    app_handle: AppHandle<R>,
    payload: LogArchivePayload,
) -> Result<(), String> {
    let data = BASE64_STANDARD
        .decode(payload.data_base64.as_bytes())
        .map_err(|err| format!("failed to decode share payload: {err}"))?;
    let path = write_share_file_sync(&app_handle, &payload.file_name, &data)?;
    let prepared = PreparedShareFile {
        path,
        file_name: payload.file_name,
        mime_type: payload.mime_type,
    };
    share_file_native(&app_handle, &prepared).await
}

fn build_logs_archive_name() -> String {
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    format!("astroboxcc-logs-{timestamp}.tar.gz")
}

fn write_share_file_sync(
    app_handle: &AppHandle<impl Runtime>,
    file_name: &str,
    data: &[u8],
) -> Result<PathBuf, String> {
    let root = app_handle
        .path()
        .app_cache_dir()
        .context("failed to resolve app cache directory")
        .map_err(|err| err.to_string())?
        .join("share");
    fs::create_dir_all(&root)
        .with_context(|| format!("failed to create share cache directory at {}", root.display()))
        .map_err(|err| err.to_string())?;
    cleanup_stale_share_cache_entries(&root);

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("failed to resolve current time")
        .map_err(|err| err.to_string())?
        .as_millis();
    let sanitized_file_name = sanitize_share_file_name(file_name);

    for suffix in 0..100 {
        let dir = root.join(format!("{timestamp}-{suffix}"));
        match fs::create_dir(&dir) {
            Ok(()) => {
                let path = dir.join(&sanitized_file_name);
                fs::write(&path, data)
                    .map_err(|err| format!("failed to write share file at {}: {err}", path.display()))?;
                return Ok(path);
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(err)
                    .with_context(|| format!("failed to create share cache item at {}", dir.display()))
                    .map_err(|err| err.to_string());
            }
        }
    }

    Err("failed to allocate a unique share cache file path".to_string())
}

fn sanitize_share_file_name(raw: &str) -> String {
    let raw_name = raw
        .rsplit(|ch| ch == '/' || ch == '\\')
        .next()
        .unwrap_or(raw)
        .trim();
    let sanitized = raw_name
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '_' | '-' | ' ' => ch,
            _ => '_',
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('.').trim();
    if trimmed.is_empty() {
        "astroboxcc-share.bin".to_string()
    } else {
        sanitized
    }
}

fn cleanup_stale_share_cache_entries(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > SHARE_CACHE_MAX_AGE);
        if !stale {
            continue;
        }
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        if let Err(err) = result {
            log::debug!(
                "[LogsShare] failed to cleanup stale share cache entry {}: {}",
                path.display(),
                err
            );
        }
    }
}

#[cfg(target_os = "android")]
async fn share_file_native<R: Runtime>(
    app_handle: &AppHandle<R>,
    prepared: &PreparedShareFile,
) -> Result<(), String> {
    let main_window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口，无法拉起系统分享".to_string())?;
    let file_path = prepared.path.to_string_lossy().to_string();
    let file_name = prepared.file_name.clone();
    let mime_type = prepared.mime_type.clone();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();

    main_window
        .with_webview(move |webview| {
            webview.jni_handle().exec(move |env, activity, _webview| {
                let result = (|| -> Result<(), String> {
                    let path = env
                        .new_string(file_path.as_str())
                        .map_err(|err| format!("无法创建分享文件路径: {err}"))?;
                    let path_obj = jni::objects::JObject::from(path);

                    let title = env
                        .new_string(file_name.as_str())
                        .map_err(|err| format!("无法创建分享标题: {err}"))?;
                    let title_obj = jni::objects::JObject::from(title);

                    let mime = env
                        .new_string(mime_type.as_str())
                        .map_err(|err| format!("无法创建分享文件 MIME: {err}"))?;
                    let mime_obj = jni::objects::JObject::from(mime);

                    let launched = env
                        .call_method(
                            activity,
                            "shareFileFromNative",
                            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z",
                            &[
                                jni::objects::JValue::Object(&path_obj),
                                jni::objects::JValue::Object(&title_obj),
                                jni::objects::JValue::Object(&mime_obj),
                            ],
                        )
                        .map_err(|err| format!("无法调用 Android 原生分享: {err}"))?
                        .z()
                        .map_err(|err| format!("无法读取 Android 原生分享结果: {err}"))?;

                    if !launched {
                        return Err("Android 原生分享启动失败".to_string());
                    }

                    Ok(())
                })();

                let _ = tx.send(result);
            });
        })
        .map_err(|err| format!("无法访问主 WebView 上下文: {err}"))?;

    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(result) => result,
        Err(_) => Err("拉起系统分享超时".to_string()),
    }
}

#[cfg(not(target_os = "android"))]
async fn share_file_native<R: Runtime>(
    _app_handle: &AppHandle<R>,
    _prepared: &PreparedShareFile,
) -> Result<(), String> {
    Err("当前系统不支持原生文件分享".to_string())
}
