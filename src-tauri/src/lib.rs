use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit};
use aes::Aes256;
use base64::{engine::general_purpose, Engine as _};
use ecb::Encryptor;
mod logs_archive;
mod logger;
mod resource_log;
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

// Simple GitHub proxy to bypass CORS in the frontend.
#[tauri::command]
async fn github_request(request: GithubProxyRequest) -> Result<Value, String> {
    if !(request.url.starts_with("https://api.github.com/")
        || request.url.starts_with("https://github.com/"))
    {
        return Err("Only GitHub endpoints are allowed".into());
    }

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("Invalid HTTP method: {}", request.method))?;

    let client = reqwest::Client::new();
    let mut builder = client.request(method, &request.url);

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
async fn afdian_request(body: String) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .user_agent("AstroBoxCreatorConsole")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .post("https://ifdian.net/api/open/query-order")
        .header("content-type", "application/json")
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
async fn fetch_media(request: FetchMediaRequest) -> Result<FetchMediaResponse, String> {
    if !request.url.starts_with("https://") {
        return Err("Only https URLs are allowed".into());
    }

    let client = reqwest::Client::builder()
        .user_agent("AstroBoxCreatorConsole")
        .build()
        .map_err(|err| err.to_string())?;

    let mut builder = client.get(&request.url);
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            builder = builder.header(&key, value);
        }
    }

    let response = builder.send().await.map_err(|err| err.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            logger::init_logger(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            github_request,
            afdian_request,
            encrypt_aes_256_ecb,
            write_text_file,
            fetch_media,
            logger::frontend_log,
            resource_log::resource_log_start,
            resource_log::resource_log_write,
            logs_archive::get_log_dir_path,
            logs_archive::export_logs_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
