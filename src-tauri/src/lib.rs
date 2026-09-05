use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit};
use aes::Aes256;
use base64::{engine::general_purpose, Engine as _};
use ecb::Encryptor;
mod afdian;
mod buildinfo;
mod logger;
mod logs_archive;
mod resource_log;

#[cfg(target_os = "macos")]
mod macos;

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct GithubProxyRequest {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

pub(crate) struct AppHttpClient(reqwest::Client);

// Simple GitHub proxy to bypass CORS in the frontend.
#[tauri::command]
async fn github_request(
    http_client: tauri::State<'_, AppHttpClient>,
    request: GithubProxyRequest,
) -> Result<Value, String> {
    if !(request.url.starts_with("https://api.github.com/")
        || request.url.starts_with("https://github.com/"))
    {
        return Err("Only GitHub endpoints are allowed".into());
    }

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("Invalid HTTP method: {}", request.method))?;

    let mut builder = http_client.0.request(method, &request.url);

    let mut has_user_agent = false;
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            if key.eq_ignore_ascii_case("user-agent") {
                has_user_agent = true;
            }
            builder = builder.header(&key, value);
        }
    }

    if !has_user_agent {
        builder = builder.header("User-Agent", "AstroBoxCreatorConsole");
    }

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;

    if !status.is_success() {
        return Err(format!("GitHub request failed ({status}): {text}"));
    }

    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text));

    Ok(body)
}

#[tauri::command]
async fn afdian_request(
    http_client: tauri::State<'_, AppHttpClient>,
    body: String,
) -> Result<Value, String> {
    let response = http_client
        .0
        .post("https://ifdian.net/api/open/query-order")
        .header("User-Agent", "AstroBoxCreatorConsole")
        .header("content-type", "application/json")
        .timeout(Duration::from_secs(30))
        .body(body)
        .send()
        .await
        .map_err(|err| format!("爱发电网络请求失败：{err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取爱发电响应失败：{err}"))?;
    let payload = serde_json::from_str::<Value>(&text)
        .map_err(|err| format!("爱发电返回了无效 JSON：{err}"))?;

    if !status.is_success() {
        return Err(format!("爱发电请求失败（HTTP {status}）：{text}"));
    }

    Ok(payload)
}
#[derive(Debug, serde::Serialize)]
struct AppBuildInfo {
    version: String,
    git_commit_hash: &'static str,
    build_time: &'static str,
    build_user: &'static str,
}

/// 暴露构建期注入的元信息（build.rs 生成 buildinfo.rs），供前端在
/// 提交 request.json 时附带当前客户端版本与构建来源。
#[tauri::command]
fn app_build_info(app: tauri::AppHandle) -> AppBuildInfo {
    AppBuildInfo {
        version: app.package_info().version.to_string(),
        git_commit_hash: buildinfo::BuildInfo::GIT_COMMIT_HASH,
        build_time: buildinfo::BuildInfo::BUILD_TIME,
        build_user: buildinfo::BuildInfo::BUILD_USER,
    }
}

#[tauri::command]
async fn encrypt_aes_256_ecb(data_base64: String, key_base64: String) -> Result<String, String> {
    let data = general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|err| format!("Invalid data base64: {err}"))?;

    let key = general_purpose::STANDARD
        .decode(key_base64)
        .map_err(|err| format!("Invalid key base64: {err}"))?;

    if key.len() != 32 {
        return Err("AES-256 key must be exactly 32 bytes".to_string());
    }

    let cipher = Encryptor::<Aes256>::new_from_slice(&key)
        .map_err(|err| format!("Invalid AES key: {err}"))?;
    let encrypted = cipher.encrypt_padded_vec_mut::<Pkcs7>(&data);

    Ok(general_purpose::STANDARD.encode(encrypted))
}

#[derive(Debug, Deserialize)]
struct FetchMediaRequest {
    url: String,
    #[serde(default)]
    headers: Option<HashMap<String, String>>,
}

#[derive(Debug, serde::Serialize)]
struct FetchMediaResponse {
    status: u16,
    content_type: Option<String>,
    body_base64: String,
}

// Fetch arbitrary remote bytes (e.g. raw.githubusercontent.com media) and
// return them base64-encoded so the frontend can build a blob: URL without
// hitting CORS. Restricted to https only.
#[tauri::command]
async fn fetch_media(
    http_client: tauri::State<'_, AppHttpClient>,
    request: FetchMediaRequest,
) -> Result<FetchMediaResponse, String> {
    if !request.url.starts_with("https://") {
        return Err("Only https URLs are allowed".into());
    }

    let mut builder = http_client.0.get(&request.url);
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            builder = builder.header(&key, value);
        }
    }

    let response = builder
        .header("User-Agent", "AstroBoxCreatorConsole")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;

    if !status.is_success() {
        return Err(format!("media request failed ({status})"));
    }

    Ok(FetchMediaResponse {
        status: status.as_u16(),
        content_type,
        body_base64: general_purpose::STANDARD.encode(&bytes),
    })
}

#[tauri::command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    let path_buf = PathBuf::from(path);

    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    fs::write(path_buf, content).map_err(|err| err.to_string())
}

#[tauri::command]
fn set_ui_scale_active(app: tauri::AppHandle, active: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos::custom_window::set_ui_scale_active(&app, active);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, active);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppHttpClient(reqwest::Client::new()))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // The log plugin is only used for its fern plumbing; the actual logger
        // is attached manually in `logger::init_logger` so that logging works
        // in release builds too.
        .plugin(tauri_plugin_log::Builder::default().skip_logger().build())
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            afdian::initialize_session_store(app.handle()).map_err(std::io::Error::other)?;
            logger::init_logger(app.handle())?;

            #[cfg(target_os = "macos")]
            macos::custom_window::adopt_tahoe_round_corners_style(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            github_request,
            afdian_request,
            afdian::afdian_session_status,
            afdian::afdian_password_login,
            afdian::afdian_send_quick_login_code,
            afdian::afdian_refresh_captcha,
            afdian::afdian_quick_login,
            afdian::afdian_logout,
            afdian::afdian_income_overview,
            afdian::afdian_management_overview,
            afdian::afdian_income_stats,
            afdian::afdian_received_orders,
            afdian::afdian_sponsors,
            encrypt_aes_256_ecb,
            app_build_info,
            write_text_file,
            set_ui_scale_active,
            fetch_media,
            logger::frontend_log,
            resource_log::resource_log_start,
            resource_log::resource_log_write,
            resource_log::resource_log_discard,
            logs_archive::export_logs_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
