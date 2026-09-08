use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
    time::Duration,
};

use keyring::{Entry, Error as KeyringError};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const KEYRING_SERVICE: &str = "moe.astralsight.astroboxcc";
const KEYRING_USER: &str = "afdian-ai-api-key";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const DOC_REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const DOC_RESPONSE_MAX_BYTES: u64 = 2 * 1024 * 1024;
const ABOX_DOC_SEARCH_URL: &str = "https://abox.run/api/search";
const ABOX_DOC_PREFIX: &str = "/docs/usage";
const BAND_WIKI_SITEMAP_URL: &str = "https://wiki.bandbbs.cn/sitemap.xml";
const BAND_WIKI_PREFIX: &str = "https://wiki.bandbbs.cn/";
const MAX_DOC_RESULTS: usize = 6;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiApiKeyStatus {
    configured: bool,
    masked: Option<String>,
    base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiHttpResponse {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiDocSearchResult {
    source: String,
    title: String,
    url: String,
    snippet: String,
}

pub(crate) struct AiHttpClient(pub(crate) reqwest::Client);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAiCredential {
    api_key: String,
    base_url: String,
}

impl AiHttpClient {
    pub(crate) fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|error| format!("无法初始化 AI 网络客户端：{error}"))?;
        Ok(Self(client))
    }
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("无法访问系统凭据库：{error}"))
}

fn load_credential() -> Result<Option<StoredAiCredential>, String> {
    match keyring_entry()?.get_password() {
        Ok(value) if !value.trim().is_empty() => serde_json::from_str(&value)
            .map(Some)
            .map_err(|_| "AI API Key 存储数据无效，请重新保存".to_string()),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法读取 AI API Key：{error}")),
    }
}

fn key_status(credential: Option<&StoredAiCredential>) -> AiApiKeyStatus {
    AiApiKeyStatus {
        configured: credential.is_some(),
        masked: credential.map(|value| crate::logger::mask_credential(&value.api_key)),
        base_url: credential.map(|value| value.base_url.clone()),
    }
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "AI API 地址无效".to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("AI API 地址必须使用 HTTPS".to_string());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn validate_request_url(value: &str, allowed_base_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "AI API 地址无效".to_string())?;
    let expected = reqwest::Url::parse(&format!(
        "{}/chat/completions",
        normalize_base_url(allowed_base_url)?
    ))
    .map_err(|_| "AI API 地址无效".to_string())?;
    if url != expected {
        return Err("AI 请求地址与 API Key 绑定的服务不一致".to_string());
    }
    Ok(url)
}

fn html_tag_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?is)<[^>]*>").expect("HTML 标签正则有效"))
}

fn html_block_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?is)<(?:script|style|svg)\b[^>]*>.*?</(?:script|style|svg)>")
            .expect("HTML 区块正则有效")
    })
}

fn html_main_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX
        .get_or_init(|| Regex::new(r"(?is)<main\b[^>]*>(.*?)</main>").expect("HTML 主内容正则有效"))
}

fn html_title_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").expect("标题正则有效"))
}

fn sitemap_location_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?is)<loc>(.*?)</loc>").expect("站点地图正则有效"))
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn normalize_doc_text(value: &str) -> String {
    let without_blocks = html_block_regex().replace_all(value, " ");
    let without_tags = html_tag_regex().replace_all(&without_blocks, " ");
    decode_html_entities(&without_tags)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let shortened = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{shortened}…")
    } else {
        shortened
    }
}

fn extract_doc_title(html: &str, fallback: &str) -> String {
    html_title_regex()
        .captures(html)
        .and_then(|captures| captures.get(1))
        .map(|value| normalize_doc_text(value.as_str()))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn extract_doc_snippet(html: &str) -> String {
    let content = html_main_regex()
        .captures(html)
        .and_then(|captures| captures.get(1))
        .map_or(html, |value| value.as_str());
    truncate_chars(&normalize_doc_text(content), 900)
}

async fn fetch_doc_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header("User-Agent", "AstroBoxCreatorConsole")
        .timeout(DOC_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("官方文档请求失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("官方文档请求失败（HTTP {}）", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > DOC_RESPONSE_MAX_BYTES)
    {
        return Err("官方文档响应过大".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取官方文档失败：{error}"))?;
    if bytes.len() as u64 > DOC_RESPONSE_MAX_BYTES {
        return Err("官方文档响应过大".to_string());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "官方文档不是有效文本".to_string())
}

fn wiki_path_hints(query: &str) -> Vec<String> {
    const MAPPINGS: &[(&str, &[&str])] = &[
        ("连接", &["connect"]),
        ("蓝牙", &["connect", "bluetooth"]),
        ("安装", &["install"]),
        ("账号", &["account"]),
        ("登录", &["account"]),
        ("插件", &["plugin"]),
        ("资源", &["resource"]),
        ("错误", &["error", "question"]),
        ("报错", &["error", "question"]),
        ("失败", &["error", "question"]),
        ("问题", &["question", "error"]),
        ("激活", &["activate"]),
        ("表盘", &["watchface"]),
        ("漫画", &["bandcomic"]),
        ("音乐", &["music"]),
        ("降级", &["downgrade"]),
        ("快应用", &["quickapp"]),
        ("天气", &["weather"]),
    ];
    let normalized = query.to_lowercase();
    let mut hints = normalized
        .split(|character: char| !character.is_alphanumeric() && character != '-')
        .filter(|value| value.chars().count() >= 3 && value.is_ascii())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for (keyword, mapped) in MAPPINGS {
        if normalized.contains(keyword) {
            hints.extend(mapped.iter().map(|value| value.to_string()));
        }
    }
    hints.sort();
    hints.dedup();
    hints
}

fn select_wiki_urls(sitemap: &str, query: &str) -> Vec<String> {
    const FALLBACK_PATHS: &[&str] = &[
        "Guides/astrobox/astrobox-errors.html",
        "Guides/astrobox/astrobox-start.html",
        "Guides/astrobox/astrobox-connect.html",
        "Guides/astrobox/astrobox-install.html",
        "Guides/astrobox/astrobox-resource.html",
        "Guides/astrobox/astrobox-plugin.html",
    ];
    let hints = wiki_path_hints(query);
    let mut candidates = sitemap_location_regex()
        .captures_iter(sitemap)
        .filter_map(|captures| captures.get(1).map(|value| value.as_str().trim()))
        .filter(|url| url.starts_with(BAND_WIKI_PREFIX))
        .map(|url| {
            let normalized = url.to_lowercase();
            let score = hints
                .iter()
                .filter(|hint| normalized.contains(hint.as_str()))
                .count();
            (score, url.to_string())
        })
        .filter(|(score, _)| *score > 0)
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.len().cmp(&right.1.len()))
    });

    let mut selected = candidates
        .into_iter()
        .map(|(_, url)| url)
        .take(4)
        .collect::<Vec<_>>();
    if selected.is_empty() {
        selected.extend(
            FALLBACK_PATHS
                .iter()
                .map(|path| format!("{BAND_WIKI_PREFIX}{path}")),
        );
    }
    selected
}

fn is_allowed_abox_doc_path(path: &str) -> bool {
    let page_path = path.split(['#', '?']).next().unwrap_or(path);
    page_path == ABOX_DOC_PREFIX || page_path.starts_with(&format!("{ABOX_DOC_PREFIX}/"))
}

async fn search_abox_docs(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<AiDocSearchResult>, String> {
    let response = client
        .get(ABOX_DOC_SEARCH_URL)
        .header("User-Agent", "AstroBoxCreatorConsole")
        .query(&[("query", query)])
        .timeout(DOC_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("AstroBox 文档搜索失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "AstroBox 文档搜索失败（HTTP {}）",
            response.status()
        ));
    }
    let payload = response
        .json::<Vec<Value>>()
        .await
        .map_err(|_| "AstroBox 文档搜索返回了无效响应".to_string())?;
    let page_titles = payload
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("page"))
        .filter_map(|item| {
            let path = item.get("url").and_then(Value::as_str)?;
            let title = item.get("content").and_then(Value::as_str)?;
            let title = normalize_doc_text(title);
            (!title.is_empty()).then(|| (path.split('#').next().unwrap_or(path).to_string(), title))
        })
        .collect::<HashMap<_, _>>();
    let mut seen_urls = HashSet::new();
    let mut results = Vec::new();

    for item in &payload {
        if item.get("type").and_then(Value::as_str) == Some("page") {
            continue;
        }
        let Some(path) = item.get("url").and_then(Value::as_str) else {
            continue;
        };
        if !is_allowed_abox_doc_path(path) {
            continue;
        }
        let page_path = path.split('#').next().unwrap_or(path);
        if !seen_urls.insert(page_path.to_string()) {
            continue;
        }
        let snippet = item
            .get("content")
            .and_then(Value::as_str)
            .map(normalize_doc_text)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "相关文档页面".to_string());
        let title = page_titles
            .get(page_path)
            .cloned()
            .unwrap_or_else(|| "AstroBox 文档".to_string());
        results.push(AiDocSearchResult {
            source: "AstroBox 文档".to_string(),
            title,
            url: format!("https://abox.run{path}"),
            snippet: truncate_chars(&snippet, 700),
        });
        if results.len() >= 4 {
            break;
        }
    }
    if results.is_empty() {
        for (path, title) in page_titles.into_iter().take(4) {
            if !is_allowed_abox_doc_path(&path) {
                continue;
            }
            results.push(AiDocSearchResult {
                source: "AstroBox 文档".to_string(),
                title: title.clone(),
                url: format!("https://abox.run{path}"),
                snippet: title,
            });
        }
    }
    Ok(results)
}

async fn search_band_wiki(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<AiDocSearchResult>, String> {
    let sitemap = fetch_doc_text(client, BAND_WIKI_SITEMAP_URL).await?;
    let urls = select_wiki_urls(&sitemap, query);
    let mut results = Vec::new();

    for url in urls {
        let Ok(html) = fetch_doc_text(client, &url).await else {
            continue;
        };
        let snippet = extract_doc_snippet(&html);
        if snippet.is_empty() {
            continue;
        }
        results.push(AiDocSearchResult {
            source: "米坛知识库".to_string(),
            title: extract_doc_title(&html, "米坛知识库"),
            url,
            snippet,
        });
        if results.len() >= 3 {
            break;
        }
    }
    Ok(results)
}

#[tauri::command]
pub(crate) fn ai_api_key_status() -> Result<AiApiKeyStatus, String> {
    let credential = load_credential()?;
    Ok(key_status(credential.as_ref()))
}

#[tauri::command]
pub(crate) fn ai_api_key_save(api_key: String, base_url: String) -> Result<AiApiKeyStatus, String> {
    let normalized = api_key.trim();
    if normalized.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    let credential = StoredAiCredential {
        api_key: normalized.to_string(),
        base_url: normalize_base_url(&base_url)?,
    };
    let stored = serde_json::to_string(&credential)
        .map_err(|error| format!("无法序列化 AI API Key：{error}"))?;
    keyring_entry()?
        .set_password(&stored)
        .map_err(|error| format!("无法保存 AI API Key：{error}"))?;
    Ok(key_status(Some(&credential)))
}

#[tauri::command]
pub(crate) fn ai_api_key_delete() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法删除 AI API Key：{error}")),
    }
}

#[tauri::command]
pub(crate) async fn ai_http_request(
    http_client: tauri::State<'_, AiHttpClient>,
    url: String,
    body: String,
) -> Result<AiHttpResponse, String> {
    let credential = load_credential()?.ok_or_else(|| "请先配置 AI API Key".to_string())?;
    let url = validate_request_url(&url, &credential.base_url)?;
    let response = http_client
        .0
        .post(url)
        .bearer_auth(credential.api_key)
        .header("User-Agent", "AstroBoxCreatorConsole")
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("AI 请求失败：{error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or_default().to_string();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| {
            matches!(
                name.as_str(),
                "content-type" | "retry-after" | "x-request-id" | "x-ratelimit-reset"
            )
        })
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取 AI 响应失败：{error}"))?;

    Ok(AiHttpResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

#[tauri::command]
pub(crate) async fn ai_docs_search(
    http_client: tauri::State<'_, AiHttpClient>,
    query: String,
) -> Result<Vec<AiDocSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let query = truncate_chars(query, 240);
    let (abox_result, wiki_timeout_result) = tokio::join!(
        search_abox_docs(&http_client.0, &query),
        tokio::time::timeout(
            Duration::from_secs(10),
            search_band_wiki(&http_client.0, &query)
        )
    );
    let wiki_result = wiki_timeout_result
        .map_err(|_| "米坛知识库搜索超时".to_string())
        .and_then(|result| result);
    let mut results = Vec::new();
    let mut errors = Vec::new();
    match abox_result {
        Ok(items) => results.extend(items),
        Err(error) => errors.push(error),
    }
    match wiki_result {
        Ok(items) => results.extend(items),
        Err(error) => errors.push(error),
    }
    results.truncate(MAX_DOC_RESULTS);
    if results.is_empty() && errors.len() == 2 {
        return Err(format!("官方文档搜索失败：{}", errors.join("；")));
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_openai_compatible_https_endpoint() {
        assert!(validate_request_url(
            "https://example.com/v1/chat/completions",
            "https://example.com/v1"
        )
        .is_ok());
    }

    #[test]
    fn rejects_non_https_and_unrelated_endpoints() {
        assert!(normalize_base_url("http://example.com/v1").is_err());
        assert!(validate_request_url(
            "https://other.example/v1/chat/completions",
            "https://example.com/v1"
        )
        .is_err());
        assert!(
            validate_request_url("https://example.com/v1/models", "https://example.com/v1")
                .is_err()
        );
    }

    #[test]
    fn masks_saved_key_status() {
        let credential = StoredAiCredential {
            api_key: "sk-example-secret-1234".to_string(),
            base_url: "https://example.com/v1".to_string(),
        };
        let status = key_status(Some(&credential));
        assert!(status.configured);
        assert_eq!(status.masked.as_deref(), Some("****1234"));
        assert_eq!(status.base_url.as_deref(), Some("https://example.com/v1"));
    }

    #[test]
    fn selects_only_allowed_wiki_urls() {
        let sitemap = r#"
            <urlset>
                <url><loc>https://wiki.bandbbs.cn/Guides/astrobox/astrobox-connect.html</loc></url>
                <url><loc>https://example.com/connect.html</loc></url>
            </urlset>
        "#;
        let urls = select_wiki_urls(sitemap, "设备连接失败");
        assert_eq!(
            urls,
            vec!["https://wiki.bandbbs.cn/Guides/astrobox/astrobox-connect.html"]
        );
    }

    #[test]
    fn accepts_only_allowed_abox_document_paths() {
        assert!(is_allowed_abox_doc_path("/docs/usage"));
        assert!(is_allowed_abox_doc_path(
            "/docs/usage/astrobox/install#android"
        ));
        assert!(!is_allowed_abox_doc_path("/docs/usage-preview"));
        assert!(!is_allowed_abox_doc_path("https://example.com/docs/usage"));
    }

    #[test]
    fn extracts_readable_document_text() {
        let html = r#"
            <html><head><title>连接帮助 | 米坛知识库</title></head>
            <body><nav>导航</nav><main><h1>连接帮助</h1><p>请检查蓝牙权限。</p></main></body></html>
        "#;
        assert_eq!(extract_doc_title(html, "备用标题"), "连接帮助 | 米坛知识库");
        assert_eq!(extract_doc_snippet(html), "连接帮助 请检查蓝牙权限。");
    }
}
