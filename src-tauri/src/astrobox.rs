use reqwest::{redirect::Policy, Method, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

pub(crate) struct AstroboxHttpClient(reqwest::Client);

impl AstroboxHttpClient {
    pub(crate) fn new() -> Result<Self, reqwest::Error> {
        Ok(Self(
            reqwest::Client::builder()
                // X-ASTROBOX-TOKEN 是自定义认证头，不允许重定向把它带到别的主机。
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(90))
                .build()?,
        ))
    }
}

#[derive(Deserialize)]
pub(crate) struct AstroboxRequest {
    url: String,
    method: String,
    token: Option<String>,
    body: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct AstroboxResponse {
    status: u16,
    #[serde(rename = "statusText")]
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

fn validate_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "AstroBox 请求地址无效".to_string())?;
    let allowed_host = matches!(
        url.host_str(),
        Some("astrobox-api.astralsight.space" | "asastrobox-api.waterflames.cn")
    );
    if url.scheme() != "https"
        || !allowed_host
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/admin/review/")
    {
        return Err("原生请求仅支持 AstroBox 官方审核接口".to_string());
    }
    Ok(url)
}

/// 审核素材以 base64 随 JSON 上传；使用原生 HTTP，避免 WebView 的 CORS 限制。
/// HTTP 错误也返回状态码和正文，由前端统一处理 403 续期、限流和 413 提示。
#[tauri::command]
pub(crate) async fn astrobox_review_request(
    http_client: tauri::State<'_, AstroboxHttpClient>,
    request: AstroboxRequest,
) -> Result<AstroboxResponse, String> {
    let url = validate_url(&request.url)?;
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|_| "AstroBox 请求方法无效".to_string())?;
    if !matches!(
        method,
        Method::GET | Method::POST | Method::PATCH | Method::DELETE
    ) {
        return Err("AstroBox 审核接口不支持该请求方法".to_string());
    }
    if request
        .body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_BODY_BYTES)
    {
        return Err("审核请求体超过 8 MiB，请减少素材后重试".to_string());
    }
    let mut builder = http_client
        .0
        .request(method, url)
        .header("User-Agent", "AstroBoxCreatorConsole")
        .header("Accept", "application/json");
    if let Some(token) = request.token {
        builder = builder.header("X-ASTROBOX-TOKEN", token);
    }
    if let Some(body) = request.body {
        builder = builder
            .header("Content-Type", "application/json")
            .body(body);
    }
    let mut response = builder
        .send()
        .await
        .map_err(|_| "无法连接 AstroBox 审核服务，请检查网络后重试".to_string())?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("AstroBox 审核响应超过大小限制".to_string());
    }
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| {
            matches!(
                name.as_str(),
                "content-type" | "retry-after" | "x-request-id"
            )
        })
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取 AstroBox 审核响应失败，请稍后重试".to_string())?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("AstroBox 审核响应超过大小限制".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(AstroboxResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_string(),
        headers,
        body: String::from_utf8(bytes).map_err(|_| "AstroBox 审核响应编码无效".to_string())?,
    })
}

#[cfg(test)]
mod tests {
    use super::validate_url;

    #[test]
    fn accepts_only_official_review_endpoints() {
        assert!(
            validate_url("https://astrobox-api.astralsight.space/admin/review/ai/runs").is_ok()
        );
        assert!(validate_url(
            "https://asastrobox-api.waterflames.cn/admin/review/guidelines?refresh=1"
        )
        .is_ok());
        for raw in [
            "http://astrobox-api.astralsight.space/admin/review/ai/runs",
            "https://astrobox-api.astralsight.space.evil.test/admin/review/ai/runs",
            "https://astrobox-api.astralsight.space:444/admin/review/ai/runs",
            "https://user:password@astrobox-api.astralsight.space/admin/review/ai/runs",
            "https://astrobox-api.astralsight.space/admin/review/../../users",
            "https://astrobox-api.astralsight.space/auth/refresh_token",
            "https://127.0.0.1/admin/review/ai/runs",
            "https://astrobox-api.astralsight.space/admin/review/ai/runs#fragment",
        ] {
            assert!(validate_url(raw).is_err(), "accepted {raw}");
        }
    }
}
