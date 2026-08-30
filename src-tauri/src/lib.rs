use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit};
use aes::Aes256;
use base64::{engine::general_purpose, Engine as _};
use ecb::Encryptor;
mod logs_archive;
mod logger;
mod resource_log;
mod buildinfo;
use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;
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

// GitHub confidential OAuth App 的 client_secret。授权码流程换 token 时
// GitHub 强制要求携带,PKCE 不能替代(该 app 不可删除唯一 secret,无法转 public client)。
// 仅附加到 access_token 端点,不暴露给前端 JS。
//
// secret 不入库,双通道读取:
// - 运行时 env GITHUB_CLIENT_SECRET(dev 时 export)
// - 编译时注入(option_env!,发布构建时 export 后编译进二进制,用户无需配置)
// 两者都无时按 public client 处理(不附加),适配未来 secret 被删除的场景。
fn github_client_secret() -> Option<String> {
    std::env::var("GITHUB_CLIENT_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| option_env!("GITHUB_CLIENT_SECRET").map(str::to_string))
}

struct AppHttpClient(reqwest::Client);

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
        // 授权码换 token:若 OAuth App 配置了 client_secret(confidential),
        // GitHub 要求携带;若已删除 secret(public client + PKCE)则不需要。
        // secret 从环境变量读取,开源仓库不保存。未设置时按 public client 处理。
        let body = if request.url.ends_with("/login/oauth/access_token") {
            match github_client_secret() {
                Some(secret) => format!("{body}&client_secret={secret}"),
                None => body,
            }
        } else {
            body
        };
        builder = builder.body(body);
    }

    log::debug!("[github_request] sending {} {}", request.method, request.url);
    let response = builder.send().await.map_err(|err| {
        log::error!("[github_request] send error: {err}");
        err.to_string()
    })?;
    log::debug!("[github_request] done status={}", response.status());
    let status = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;

    if !status.is_success() {
        return Err(format!("GitHub request failed ({status}): {text}"));
    }

    // 诊断:登录 token 交换时 GitHub 对坏 code 仍返回 200,但 body 带 error。
    // 只记 error/error_description 字段与 access_token 是否存在,不记 token 本身。
    if request.url.contains("/login/oauth/access_token") {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            let has_token = v.get("access_token").is_some();
            let err = v
                .get("error")
                .and_then(|e| e.as_str())
                .map(|e| {
                    let desc = v
                        .get("error_description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("");
                    format!("{e}: {desc}")
                })
                .unwrap_or_else(|| "none".into());
            log::debug!("[github_request] token exchange body: access_token={has_token} error={err}");
        }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 显式 connect/request 超时:环境代理下 reqwest 对 github.com 的
        // 连接曾无限挂起(invoke 永不返回),前端 github.ts 已加 invoke 超时
        // 回退 axios;这里从根上保证任何网络请求都不会永久卡住。
        .manage(AppHttpClient(
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()
                .expect("failed to build reqwest client"),
        ))
        .plugin(tauri_plugin_deep_link::init())
        // 单实例 + deep-link 转发:Linux/Windows 上深链会新起一个进程,由本插件
        // 把 argv 里的 URL 转发给已运行实例(deep-link 插件的 onOpenUrl 因此
        // 在原实例内触发,登录 pending 状态得以保留),第二实例随即退出。
        // 注意:dev 与 release 共用 D-Bus 名(bundle identifier),不能同时运行。
        .plugin(
            tauri_plugin_single_instance::Builder::new()
                // dev 与 release 用不同的 D-Bus 名,两者同时运行时互不吞实例,
                // 各自只收自己那套深链。release 用 bundle identifier 作默认值。
                .dbus_id(if cfg!(debug_assertions) {
                    "moe.astralsight.astroboxcc.dev"
                } else {
                    "moe.astralsight.astroboxcc"
                })
                .callback(|app, _args, _cwd| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                })
                .build(),
        )
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
            resource_log::resource_log_discard,
            logs_archive::export_logs_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
