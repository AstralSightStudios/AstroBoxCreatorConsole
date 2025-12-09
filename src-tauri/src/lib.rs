use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

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
        .invoke_handler(tauri::generate_handler![github_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
