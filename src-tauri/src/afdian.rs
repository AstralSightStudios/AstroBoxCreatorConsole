use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use aes::Aes256;
use base64::{engine::general_purpose, Engine as _};
use cbc::Encryptor as CbcEncryptor;
use chrono::{DateTime, FixedOffset, Utc};
use rand::{rngs::OsRng, RngCore};
use rsa::{pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppHttpClient;

const AFDIAN_BASE_URL: &str = "https://afdian.com";
const IFDIAN_BASE_URL: &str = "https://ifdian.net";
const AFDIAN_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 AstroBoxCreatorConsole";
const AFDIAN_KEYRING_SERVICE: &str = "moe.astralsight.astroboxcc.afdian";
const AFDIAN_KEYRING_ACCOUNT: &str = "session";
const LOGIN_AES_IV: &[u8; 16] = b"7brVHncu7wIDAQAB";
const LOGIN_PUBLIC_KEY: &str = r#"-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4Top/Mt2ofZeAIMh9AHw
4d6Q+iyBxXbou+1mbhclLsB3YSMbFD+X6QnlAY1vMHO7fteKevn25iVIELBXsmcQ
S5/oA2hO3VHi9uTG3XmYVcrw94cK5ppODeBOV0hV0dFS/NOT66pqPAuLW6HgRrnt
gznl4ju6ttOddDNJ7e97RH9qrZEpzjl9GqVZQ2sFdmmw4dNET9fP9HWq8VlfW+BF
G7TuxzEjZNcxAgrG/f41Z0+G3RxAccF8LOxu4Ztk1ZDdv5xukdx2ukoEhgdmKUkD
v/W5r3HPj1uX+buzDi/UsumMblWXb0Bys7ENhZ/n4+naZ3b3rJ32DnTF7brVHncu
7wIDAQAB
-----END PUBLIC KEY-----"#;

type Aes256CbcEncryptor = CbcEncryptor<Aes256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    auth_token: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianSessionStatus {
    connected: bool,
    display_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianQuickCodeResult {
    status: String,
    message: String,
    captcha_image: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianIncomeOverview {
    current_month: Option<String>,
    today: String,
    yesterday: String,
    as_of: String,
}

#[derive(Debug, Serialize)]
struct PasswordLoginPayload {
    account: String,
    password: String,
    mp_token: String,
    ar_ept: String,
}

#[derive(Debug, Serialize)]
struct SendQuickCodePayload {
    account: String,
    account_type: String,
    captcha_code: String,
    ar_ept: String,
}

#[derive(Debug, Serialize)]
struct QuickLoginPayload {
    account: String,
    code: String,
    mp_token: String,
    ar_ept: String,
}

#[derive(Debug, Serialize)]
struct RefreshCaptchaPayload {
    account: String,
}

#[tauri::command]
pub(crate) fn afdian_session_status() -> Result<AfdianSessionStatus, String> {
    let session = load_session()?;
    Ok(AfdianSessionStatus {
        connected: session.is_some(),
        display_name: session.map(|value| value.display_name),
    })
}

#[tauri::command]
pub(crate) async fn afdian_password_login(
    http_client: tauri::State<'_, AppHttpClient>,
    account: String,
    password: String,
) -> Result<AfdianSessionStatus, String> {
    let normalized_account = account.trim();
    if normalized_account.is_empty() || password.is_empty() {
        return Err("请输入爱发电账号和密码".into());
    }

    let aes_key = make_aes_key();
    let payload = PasswordLoginPayload {
        account: aes_encrypt(normalized_account, &aes_key)?,
        password: aes_encrypt(&password, &aes_key)?,
        mp_token: String::new(),
        ar_ept: rsa_encrypt(&aes_key)?,
    };
    let response = post_json(
        &http_client.0,
        &format!("{AFDIAN_BASE_URL}/api/passport/login"),
        &payload,
    )
    .await?;
    let token = extract_auth_token(&response)?;
    complete_login(&http_client.0, token, normalized_account).await
}

#[tauri::command]
pub(crate) async fn afdian_send_quick_login_code(
    http_client: tauri::State<'_, AppHttpClient>,
    phone: String,
    captcha_code: String,
) -> Result<AfdianQuickCodeResult, String> {
    let normalized_phone = phone.trim();
    if normalized_phone.is_empty() {
        return Err("请输入手机号".into());
    }

    let aes_key = make_aes_key();
    let payload = SendQuickCodePayload {
        account: aes_encrypt(normalized_phone, &aes_key)?,
        account_type: String::new(),
        captcha_code: captcha_code.trim().to_string(),
        ar_ept: rsa_encrypt(&aes_key)?,
    };
    let response = post_json(
        &http_client.0,
        &format!("{AFDIAN_BASE_URL}/api/passport/send-quick-login-code"),
        &payload,
    )
    .await?;
    let code = api_code(&response);
    let message = api_message(&response).unwrap_or_else(|| "验证码发送失败".into());
    let captcha_image = response
        .pointer("/data/captcha_img")
        .and_then(Value::as_str)
        .map(str::to_string);

    match code {
        Some(200) => Ok(AfdianQuickCodeResult {
            status: "sent".into(),
            message,
            captcha_image: None,
        }),
        Some(201) if captcha_image.is_some() => Ok(AfdianQuickCodeResult {
            status: "captchaRequired".into(),
            message,
            captcha_image,
        }),
        Some(501) => Ok(AfdianQuickCodeResult {
            status: "captchaInvalid".into(),
            message,
            captcha_image,
        }),
        _ => Err(message),
    }
}

#[tauri::command]
pub(crate) async fn afdian_refresh_captcha(
    http_client: tauri::State<'_, AppHttpClient>,
    phone: String,
) -> Result<String, String> {
    let normalized_phone = phone.trim();
    if normalized_phone.is_empty() {
        return Err("请输入手机号".into());
    }

    let response = post_json(
        &http_client.0,
        &format!("{AFDIAN_BASE_URL}/api/passport/refresh-captcha"),
        &RefreshCaptchaPayload {
            account: normalized_phone.to_string(),
        },
    )
    .await?;
    response
        .pointer("/data/captcha_img")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| api_message(&response).unwrap_or_else(|| "图形验证码刷新失败".into()))
}

#[tauri::command]
pub(crate) async fn afdian_quick_login(
    http_client: tauri::State<'_, AppHttpClient>,
    phone: String,
    code: String,
) -> Result<AfdianSessionStatus, String> {
    let normalized_phone = phone.trim();
    let normalized_code = code.trim();
    if normalized_phone.is_empty() || normalized_code.is_empty() {
        return Err("请输入手机号和短信验证码".into());
    }

    let aes_key = make_aes_key();
    let payload = QuickLoginPayload {
        account: aes_encrypt(normalized_phone, &aes_key)?,
        code: aes_encrypt(normalized_code, &aes_key)?,
        mp_token: String::new(),
        ar_ept: rsa_encrypt(&aes_key)?,
    };
    let response = post_json(
        &http_client.0,
        &format!("{AFDIAN_BASE_URL}/api/passport/quick-login"),
        &payload,
    )
    .await?;
    let token = extract_auth_token(&response)?;
    complete_login(&http_client.0, token, normalized_phone).await
}

#[tauri::command]
pub(crate) fn afdian_logout() -> Result<(), String> {
    clear_session()
}

#[tauri::command]
pub(crate) async fn afdian_income_overview(
    http_client: tauri::State<'_, AppHttpClient>,
) -> Result<AfdianIncomeOverview, String> {
    let session = load_session()?.ok_or_else(|| "请先登录爱发电账户".to_string())?;
    let dashboard_url = format!("{IFDIAN_BASE_URL}/api/my/dashboard");
    let stats_url = format!("{IFDIAN_BASE_URL}/api/my/stat");
    let dashboard = authenticated_get(&http_client.0, &dashboard_url, &session.auth_token, &[]);
    let stats = authenticated_get(
        &http_client.0,
        &stats_url,
        &session.auth_token,
        &[("page", "1"), ("type", "day")],
    );
    let (dashboard, stats) = tokio::try_join!(dashboard, stats)?;
    ensure_api_success(&dashboard, "本月收入加载失败")?;
    ensure_api_success(&stats, "每日收入加载失败")?;

    let timezone = FixedOffset::east_opt(8 * 60 * 60).expect("固定时区有效");
    let now = Utc::now().with_timezone(&timezone);
    Ok(extract_income_overview(&dashboard, &stats, now))
}

async fn complete_login(
    client: &reqwest::Client,
    auth_token: String,
    fallback_account: &str,
) -> Result<AfdianSessionStatus, String> {
    let display_name = fetch_display_name(client, &auth_token)
        .await
        .unwrap_or_else(|_| mask_account(fallback_account));
    save_session(&StoredSession {
        auth_token,
        display_name: display_name.clone(),
    })?;
    Ok(AfdianSessionStatus {
        connected: true,
        display_name: Some(display_name),
    })
}

async fn fetch_display_name(client: &reqwest::Client, token: &str) -> Result<String, String> {
    let response = authenticated_get(
        client,
        &format!("{AFDIAN_BASE_URL}/api/my/account"),
        token,
        &[],
    )
    .await?;
    ensure_api_success(&response, "账号信息加载失败")?;

    response
        .pointer("/data/oauth/wect/nickname")
        .or_else(|| response.pointer("/data/login/email"))
        .or_else(|| response.pointer("/data/login/phone"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "无法读取爱发电账户信息".into())
}

async fn post_json<T: Serialize + ?Sized>(
    client: &reqwest::Client,
    url: &str,
    body: &T,
) -> Result<Value, String> {
    let response = client
        .post(url)
        .header("User-Agent", AFDIAN_USER_AGENT)
        .header("Referer", AFDIAN_BASE_URL)
        .header("Origin", AFDIAN_BASE_URL)
        .json(body)
        .send()
        .await
        .map_err(|error| format!("爱发电网络请求失败：{error}"))?;
    parse_json_response(response).await
}

async fn authenticated_get(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    query: &[(&str, &str)],
) -> Result<Value, String> {
    let mut request = client
        .get(url)
        .header("User-Agent", AFDIAN_USER_AGENT)
        .header("Referer", AFDIAN_BASE_URL)
        .header("Cookie", format!("auth_token={token}"))
        .query(&[("auth_token", token)]);
    if !query.is_empty() {
        request = request.query(query);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("爱发电网络请求失败：{error}"))?;
    parse_json_response(response).await
}

async fn parse_json_response(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("爱发电请求失败（HTTP {status}）"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|_| "爱发电返回了无效响应".into())
}

fn extract_auth_token(response: &Value) -> Result<String, String> {
    ensure_api_success(response, "登录失败，请检查账号信息")?;
    response
        .pointer("/data/auth_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "爱发电登录响应中没有有效凭据".into())
}

fn ensure_api_success(response: &Value, fallback: &str) -> Result<(), String> {
    if api_code(response) == Some(200) {
        return Ok(());
    }
    Err(api_message(response).unwrap_or_else(|| fallback.to_string()))
}

fn api_code(response: &Value) -> Option<i64> {
    response.get("ec").and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
    })
}

fn api_message(response: &Value) -> Option<String> {
    response
        .get("em")
        .or_else(|| response.get("msg"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn extract_income_overview(
    dashboard: &Value,
    stats: &Value,
    now: DateTime<FixedOffset>,
) -> AfdianIncomeOverview {
    let today_key = now.format("%Y%m%d").to_string();
    let yesterday_key = now
        .date_naive()
        .pred_opt()
        .map(|date| date.format("%Y%m%d").to_string())
        .unwrap_or_default();
    let records = stats
        .pointer("/data/list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    AfdianIncomeOverview {
        current_month: dashboard
            .pointer("/data/summary/month_amount")
            .and_then(value_to_amount),
        today: find_daily_amount(&records, &today_key).unwrap_or_else(|| "0".into()),
        yesterday: find_daily_amount(&records, &yesterday_key).unwrap_or_else(|| "0".into()),
        as_of: now.to_rfc3339(),
    }
}

fn find_daily_amount(records: &[Value], date_key: &str) -> Option<String> {
    records.iter().find_map(|record| {
        let date = record.get("date_str").and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| value.as_i64().map(|number| number.to_string()))
        })?;
        if date != date_key {
            return None;
        }
        record
            .get("paid_order_real_amount")
            .and_then(value_to_amount)
    })
}

fn value_to_amount(value: &Value) -> Option<String> {
    match value {
        Value::String(raw) if !raw.trim().is_empty() => Some(raw.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn make_aes_key() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn aes_encrypt(value: &str, aes_key: &str) -> Result<String, String> {
    let cipher = Aes256CbcEncryptor::new_from_slices(aes_key.as_bytes(), LOGIN_AES_IV)
        .map_err(|_| "爱发电登录加密初始化失败".to_string())?;
    let encrypted = cipher.encrypt_padded_vec_mut::<Pkcs7>(value.as_bytes());
    Ok(general_purpose::STANDARD.encode(encrypted))
}

fn rsa_encrypt(value: &str) -> Result<String, String> {
    let public_key = RsaPublicKey::from_public_key_pem(LOGIN_PUBLIC_KEY)
        .map_err(|_| "爱发电登录公钥无效".to_string())?;
    let encrypted = public_key
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, value.as_bytes())
        .map_err(|_| "爱发电登录密钥加密失败".to_string())?;
    Ok(general_purpose::STANDARD.encode(encrypted))
}

fn mask_account(value: &str) -> String {
    if let Some((name, domain)) = value.split_once('@') {
        let prefix = name
            .chars()
            .next()
            .map(|char| char.to_string())
            .unwrap_or_default();
        return format!("{prefix}***@{domain}");
    }
    let chars: Vec<char> = value.chars().collect();
    if chars.len() > 7 {
        return format!(
            "{}****{}",
            chars.iter().take(3).collect::<String>(),
            chars.iter().skip(chars.len() - 2).collect::<String>()
        );
    }
    "爱发电用户".into()
}

#[cfg(not(target_os = "android"))]
fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(AFDIAN_KEYRING_SERVICE, AFDIAN_KEYRING_ACCOUNT)
        .map_err(|error| format!("系统凭据存储不可用：{error}"))
}

#[cfg(not(target_os = "android"))]
fn load_session() -> Result<Option<StoredSession>, String> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|_| "爱发电登录凭据已损坏，请重新登录".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法读取系统凭据：{error}")),
    }
}

#[cfg(not(target_os = "android"))]
fn save_session(session: &StoredSession) -> Result<(), String> {
    let raw = serde_json::to_string(session).map_err(|_| "无法保存爱发电登录状态".to_string())?;
    keyring_entry()?
        .set_password(&raw)
        .map_err(|error| format!("无法写入系统凭据：{error}"))
}

#[cfg(not(target_os = "android"))]
fn clear_session() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法清除系统凭据：{error}")),
    }
}

#[cfg(target_os = "android")]
fn load_session() -> Result<Option<StoredSession>, String> {
    Err("当前 Android 版本暂不支持爱发电登录".into())
}

#[cfg(target_os = "android")]
fn save_session(_session: &StoredSession) -> Result<(), String> {
    Err("当前 Android 版本暂不支持爱发电登录".into())
}

#[cfg(target_os = "android")]
fn clear_session() -> Result<(), String> {
    Err("当前 Android 版本暂不支持爱发电登录".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    #[test]
    fn extracts_income_for_shanghai_dates() {
        let dashboard = json!({
            "ec": 200,
            "data": { "summary": { "month_amount": "123.45" } }
        });
        let stats = json!({
            "ec": 200,
            "data": {
                "list": [
                    { "date_str": "20260830", "paid_order_real_amount": "12.30" },
                    { "date_str": 20260829, "paid_order_real_amount": 8.5 }
                ]
            }
        });
        let timezone = FixedOffset::east_opt(8 * 60 * 60).unwrap();
        let now = timezone.with_ymd_and_hms(2026, 8, 30, 12, 0, 0).unwrap();

        let overview = extract_income_overview(&dashboard, &stats, now);

        assert_eq!(overview.current_month.as_deref(), Some("123.45"));
        assert_eq!(overview.today, "12.30");
        assert_eq!(overview.yesterday, "8.5");
        assert_eq!(overview.as_of, "2026-08-30T12:00:00+08:00");
    }

    #[test]
    fn defaults_missing_daily_income_to_zero() {
        let timezone = FixedOffset::east_opt(8 * 60 * 60).unwrap();
        let now = timezone.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let overview = extract_income_overview(
            &json!({ "data": { "summary": {} } }),
            &json!({ "data": { "list": [] } }),
            now,
        );

        assert_eq!(overview.current_month, None);
        assert_eq!(overview.today, "0");
        assert_eq!(overview.yesterday, "0");
    }

    #[test]
    fn builds_encrypted_login_fields() {
        let aes_key = make_aes_key();
        let account = aes_encrypt("creator@example.com", &aes_key).unwrap();
        let encrypted_key = rsa_encrypt(&aes_key).unwrap();

        assert_eq!(aes_key.len(), 32);
        assert_ne!(account, "creator@example.com");
        assert!(general_purpose::STANDARD.decode(account).is_ok());
        assert_eq!(
            general_purpose::STANDARD
                .decode(encrypted_key)
                .unwrap()
                .len(),
            256
        );
    }

    #[test]
    fn masks_login_identifiers() {
        assert_eq!(mask_account("creator@example.com"), "c***@example.com");
        assert_eq!(mask_account("13800138000"), "138****00");
        assert_eq!(mask_account("short"), "爱发电用户");
    }
}
