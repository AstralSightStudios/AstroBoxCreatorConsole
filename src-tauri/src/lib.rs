use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit};
use aes::Aes256;
use base64::{engine::general_purpose, Engine as _};
use ecb::Encryptor;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            github_request,
            encrypt_aes_256_ecb,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
