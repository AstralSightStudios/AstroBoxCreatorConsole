use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use aes::Aes256;
use base64::{engine::general_purpose, Engine as _};
use cbc::Encryptor as CbcEncryptor;
use chrono::{DateTime, Datelike, FixedOffset, Timelike, Utc};
use rand::{rngs::OsRng, RngCore};
use rsa::{pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Mutex, OnceLock},
};
use tauri::Manager;

use crate::AppHttpClient;

const AFDIAN_BASE_URL: &str = "https://afdian.com";
const IFDIAN_BASE_URL: &str = "https://ifdian.net";
const AFDIAN_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 AstroBoxCreatorConsole";
const AFDIAN_SESSION_FILE_NAME: &str = "afdian-session.json";
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

#[derive(Default)]
struct SessionCache {
    loaded: bool,
    session: Option<StoredSession>,
}

static AFDIAN_SESSION_CACHE: OnceLock<Mutex<SessionCache>> = OnceLock::new();
static AFDIAN_SESSION_PATH: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn initialize_session_store(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let path = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法确定爱发电会话存储目录：{error}"))?
        .join(AFDIAN_SESSION_FILE_NAME);
    AFDIAN_SESSION_PATH
        .set(path)
        .map_err(|_| "爱发电会话存储已初始化".to_string())
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
    previous_month: String,
    withdrawable: Option<String>,
    today: String,
    yesterday: String,
    as_of: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianManagementOverview {
    today_income: String,
    today_order_count: usize,
    month_income: Option<String>,
    all_income: Option<String>,
    recent_sponsor_count: Option<i64>,
    all_sponsor_count: Option<i64>,
    uv: Option<i64>,
    pv: Option<i64>,
    balance: Option<String>,
    balance_after_tax: Option<String>,
    as_of: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianIncomeStatItem {
    date: String,
    income: String,
    order_count: Option<i64>,
    sponsor_count: Option<i64>,
    returning_sponsor_count: Option<i64>,
    uv: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianIncomeStatPage {
    items: Vec<AfdianIncomeStatItem>,
    page: usize,
    has_more: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianReceivedOrder {
    id: String,
    title: String,
    amount: String,
    status: Option<i64>,
    created_at: Option<String>,
    sponsor_name: String,
    sponsor_avatar: Option<String>,
    plan_name: Option<String>,
    remark: Option<String>,
    product_type: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianReceivedOrderPage {
    items: Vec<AfdianReceivedOrder>,
    page: usize,
    has_more: bool,
    next_order_id: Option<String>,
    next_cart_order_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianSponsorItem {
    id: String,
    name: String,
    avatar: Option<String>,
    total_amount: String,
    first_sponsored_at: Option<String>,
    last_sponsored_at: Option<String>,
    plan_names: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AfdianSponsorPage {
    items: Vec<AfdianSponsorItem>,
    page: usize,
    total_count: Option<i64>,
    total_page: Option<i64>,
    has_more: bool,
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
    let timezone = FixedOffset::east_opt(8 * 60 * 60).expect("固定时区有效");
    let now = Utc::now().with_timezone(&timezone);
    let current_month_start = now.date_naive().with_day(1).expect("当月首日有效");
    let previous_month_date = current_month_start.pred_opt().expect("上月最后一天有效");
    let settlement_window = now.day() == 1 && now.hour() < 10;
    let aggregation_start_key = if settlement_window {
        previous_month_date.format("%Y%m01").to_string()
    } else {
        current_month_start.format("%Y%m%d").to_string()
    };
    let dashboard_url = format!("{IFDIAN_BASE_URL}/api/my/dashboard");
    let dashboard = authenticated_get(&http_client.0, &dashboard_url, &session.auth_token, &[]);
    let orders = fetch_received_orders(
        &http_client.0,
        &session.auth_token,
        &aggregation_start_key,
        &timezone,
    );
    let (dashboard, orders) = tokio::try_join!(dashboard, orders)?;
    ensure_api_success(&dashboard, "结算信息加载失败")?;

    Ok(aggregate_order_income(&orders, &dashboard, now))
}

#[tauri::command]
pub(crate) async fn afdian_management_overview(
    http_client: tauri::State<'_, AppHttpClient>,
) -> Result<AfdianManagementOverview, String> {
    let session = load_session()?.ok_or_else(|| "请先登录爱发电账户".to_string())?;
    let timezone = shanghai_timezone();
    let now = Utc::now().with_timezone(&timezone);
    let dashboard_url = format!("{AFDIAN_BASE_URL}/api/my/dashboard");
    let dashboard = authenticated_get(&http_client.0, &dashboard_url, &session.auth_token, &[]);
    let today_orders = fetch_today_income_orders(&http_client.0, &session.auth_token, &timezone);
    let (dashboard, today_orders) = tokio::try_join!(dashboard, today_orders)?;
    ensure_api_success(&dashboard, "收入概况加载失败")?;
    let (today_income, today_order_count) = sum_income_orders(&today_orders);

    Ok(AfdianManagementOverview {
        today_income: format_decimal(today_income),
        today_order_count,
        month_income: dashboard
            .pointer("/data/summary/month_amount")
            .and_then(value_to_amount),
        all_income: dashboard
            .pointer("/data/summary/all_sum_amount")
            .and_then(value_to_amount),
        recent_sponsor_count: dashboard
            .pointer("/data/summary/month_sponsor_count")
            .and_then(value_to_i64),
        all_sponsor_count: dashboard
            .pointer("/data/summary/all_sponsor_count")
            .and_then(value_to_i64),
        uv: dashboard.pointer("/data/summary/uv").and_then(value_to_i64),
        pv: dashboard.pointer("/data/summary/pv").and_then(value_to_i64),
        balance: dashboard.pointer("/data/balance").and_then(value_to_amount),
        balance_after_tax: dashboard
            .pointer("/data/balance_after_tax")
            .and_then(value_to_amount),
        as_of: now.to_rfc3339(),
    })
}

#[tauri::command]
pub(crate) async fn afdian_income_stats(
    http_client: tauri::State<'_, AppHttpClient>,
    page: usize,
) -> Result<AfdianIncomeStatPage, String> {
    let session = load_session()?.ok_or_else(|| "请先登录爱发电账户".to_string())?;
    let page = page.max(1);
    let page_value = page.to_string();
    let response = authenticated_get(
        &http_client.0,
        &format!("{AFDIAN_BASE_URL}/api/my/stat"),
        &session.auth_token,
        &[("page", page_value.as_str()), ("type", "day")],
    )
    .await?;
    ensure_api_success(&response, "收入统计加载失败")?;
    let records = response
        .pointer("/data/list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let has_more = match response.pointer("/data/has_more").and_then(value_to_i64) {
        Some(value) => value == 1,
        None => records.len() >= 10,
    };
    let items = records
        .iter()
        .map(|record| AfdianIncomeStatItem {
            date: record
                .get("date_str")
                .and_then(value_to_text)
                .and_then(|value| normalize_date_key(&value))
                .map(|value| format!("{}-{}-{}", &value[..4], &value[4..6], &value[6..8]))
                .unwrap_or_else(|| "--".into()),
            income: record
                .get("paid_order_real_amount")
                .and_then(value_to_amount)
                .unwrap_or_else(|| "0".into()),
            order_count: record.get("paid_order_count").and_then(value_to_i64),
            sponsor_count: record.get("paid_user_count").and_then(value_to_i64),
            returning_sponsor_count: record.get("paid_old_user_count").and_then(value_to_i64),
            uv: record.get("uv").and_then(value_to_i64),
        })
        .collect();

    Ok(AfdianIncomeStatPage {
        items,
        page,
        has_more,
    })
}

#[tauri::command]
pub(crate) async fn afdian_received_orders(
    http_client: tauri::State<'_, AppHttpClient>,
    page: usize,
    last_order_id: Option<String>,
    last_cart_order_id: Option<String>,
) -> Result<AfdianReceivedOrderPage, String> {
    let session = load_session()?.ok_or_else(|| "请先登录爱发电账户".to_string())?;
    let page = page.max(1);
    let response = fetch_received_order_page(
        &http_client.0,
        &session.auth_token,
        page,
        last_order_id.as_deref(),
        last_cart_order_id.as_deref(),
        "update_time",
    )
    .await?;
    let items = response
        .pointer("/data/list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(parse_received_order)
        .collect();

    Ok(AfdianReceivedOrderPage {
        items,
        page,
        has_more: response.pointer("/data/has_more").and_then(value_to_i64) == Some(1),
        next_order_id: response
            .pointer("/data/last_order_id")
            .and_then(value_to_text),
        next_cart_order_id: response
            .pointer("/data/last_cart_order_id")
            .and_then(value_to_text),
    })
}

#[tauri::command]
pub(crate) async fn afdian_sponsors(
    http_client: tauri::State<'_, AppHttpClient>,
    page: usize,
) -> Result<AfdianSponsorPage, String> {
    let session = load_session()?.ok_or_else(|| "请先登录爱发电账户".to_string())?;
    let page = page.max(1);
    let page_value = page.to_string();
    let response = authenticated_get(
        &http_client.0,
        &format!("{AFDIAN_BASE_URL}/api/my/who-sponsored-me"),
        &session.auth_token,
        &[("page", page_value.as_str())],
    )
    .await?;
    ensure_api_success(&response, "赞助者管理加载失败")?;
    let total_count = response.pointer("/data/total_count").and_then(value_to_i64);
    let total_page = response.pointer("/data/total_page").and_then(value_to_i64);
    let items = response
        .pointer("/data/list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(parse_sponsor_item)
        .collect();

    Ok(AfdianSponsorPage {
        items,
        page,
        total_count,
        total_page,
        has_more: total_page.is_some_and(|total| page < total.max(0) as usize),
    })
}

async fn fetch_received_orders(
    client: &reqwest::Client,
    token: &str,
    aggregation_start_key: &str,
    timezone: &FixedOffset,
) -> Result<Vec<Value>, String> {
    let orders_url = format!("{IFDIAN_BASE_URL}/api/my/sponsored-bill-filter");
    let mut orders = Vec::new();

    for page in 1..=100 {
        let page_value = page.to_string();
        let response = authenticated_get(
            client,
            &orders_url,
            token,
            &[
                ("page", page_value.as_str()),
                ("sort_field", "create_time"),
                ("sort_value", "desc"),
                ("is_redeem", "0"),
                ("plan_id", ""),
                ("sign_status", ""),
                ("has_remark", "0"),
                ("status", ""),
                ("order_id", ""),
                ("nick_name", ""),
                ("user_id", ""),
                ("remark", ""),
                ("order_remark", ""),
                ("express_no", ""),
                ("last_cart_order_id", ""),
                ("last_order_id", ""),
                ("begin_time", ""),
                ("end_time", ""),
            ],
        )
        .await?;
        ensure_api_success(&response, "订单收入加载失败")?;
        let page_orders = response
            .pointer("/data/list")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let order_count = page_orders.len();
        let reached_before_range = page_orders.iter().any(|order| {
            order_date_key(order, timezone)
                .is_some_and(|date_key| date_key.as_str() < aggregation_start_key)
        });
        orders.extend(page_orders);

        let has_more = response.pointer("/data/has_more").and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
        });
        if order_count == 0
            || reached_before_range
            || has_more == Some(0)
            || (has_more.is_none() && order_count < 10)
        {
            break;
        }
    }

    Ok(orders)
}

async fn fetch_received_order_page(
    client: &reqwest::Client,
    token: &str,
    page: usize,
    last_order_id: Option<&str>,
    last_cart_order_id: Option<&str>,
    sort_field: &str,
) -> Result<Value, String> {
    let page_value = page.to_string();
    let mut query = vec![
        ("page", page_value.as_str()),
        ("sort_field", sort_field),
        ("sort_value", "desc"),
        ("is_redeem", "0"),
        ("plan_id", ""),
        ("sign_status", ""),
        ("has_remark", "0"),
        ("status", ""),
        ("order_id", ""),
        ("nick_name", ""),
        ("user_id", ""),
        ("remark", ""),
        ("order_remark", ""),
        ("express_no", ""),
        ("begin_time", ""),
        ("end_time", ""),
    ];
    if let Some(value) = last_order_id.filter(|value| !value.is_empty()) {
        query.push(("last_order_id", value));
    }
    if let Some(value) = last_cart_order_id.filter(|value| !value.is_empty()) {
        query.push(("last_cart_order_id", value));
    }
    let response = authenticated_get(
        client,
        &format!("{AFDIAN_BASE_URL}/api/my/sponsored-bill-filter"),
        token,
        &query,
    )
    .await?;
    ensure_api_success(&response, "收到发电加载失败")?;
    Ok(response)
}

async fn fetch_today_income_orders(
    client: &reqwest::Client,
    token: &str,
    timezone: &FixedOffset,
) -> Result<Vec<Value>, String> {
    let today_key = Utc::now()
        .with_timezone(timezone)
        .format("%Y%m%d")
        .to_string();
    let mut orders = Vec::new();
    let mut last_order_id: Option<String> = None;
    let mut last_cart_order_id: Option<String> = None;

    for page in 1..=50 {
        let response = fetch_received_order_page(
            client,
            token,
            page,
            last_order_id.as_deref(),
            last_cart_order_id.as_deref(),
            "create_time",
        )
        .await?;
        let page_orders = response
            .pointer("/data/list")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut reached_previous_day = false;
        for order in page_orders {
            let date_key = order_date_key(&order, timezone);
            match date_key.as_deref() {
                Some(value) if value < today_key.as_str() => {
                    reached_previous_day = true;
                }
                Some(value) if value == today_key && is_income_order(&order) => orders.push(order),
                _ => {}
            }
        }
        if reached_previous_day
            || response.pointer("/data/has_more").and_then(value_to_i64) != Some(1)
        {
            break;
        }
        last_order_id = response
            .pointer("/data/last_order_id")
            .and_then(value_to_text);
        last_cart_order_id = response
            .pointer("/data/last_cart_order_id")
            .and_then(value_to_text);
        if last_order_id.as_deref().unwrap_or_default().is_empty() {
            break;
        }
    }

    Ok(orders)
}

fn sum_income_orders(orders: &[Value]) -> (Decimal, usize) {
    let mut seen = HashSet::new();
    orders
        .iter()
        .fold((Decimal::ZERO, 0), |(amount, count), order| {
            if !is_income_order(order) {
                return (amount, count);
            }
            if let Some(identity) = order_identity(order) {
                if !seen.insert(identity) {
                    return (amount, count);
                }
            }
            let order_amount = order
                .get("total_amount")
                .and_then(value_to_amount)
                .and_then(|value| parse_decimal(&value))
                .unwrap_or(Decimal::ZERO);
            (amount + order_amount, count + 1)
        })
}

fn parse_received_order(order: &Value) -> AfdianReceivedOrder {
    let id = order
        .get("out_trade_no")
        .and_then(value_to_text)
        .or_else(|| order.get("id").and_then(value_to_text))
        .or_else(|| order.get("order_id").and_then(value_to_text))
        .unwrap_or_else(|| "unknown".into());
    AfdianReceivedOrder {
        id,
        title: order
            .get("title")
            .and_then(value_to_text)
            .unwrap_or_else(|| "发电订单".into()),
        amount: order
            .get("total_amount")
            .and_then(value_to_amount)
            .unwrap_or_else(|| "0".into()),
        status: order.get("status").and_then(value_to_i64),
        created_at: order
            .get("create_time")
            .and_then(|value| timestamp_to_rfc3339(value, &shanghai_timezone())),
        sponsor_name: order
            .pointer("/user/name")
            .and_then(value_to_text)
            .unwrap_or_else(|| "爱发电用户".into()),
        sponsor_avatar: order.pointer("/user/avatar").and_then(value_to_text),
        plan_name: order.pointer("/plan/name").and_then(value_to_text),
        remark: order
            .get("remark")
            .and_then(value_to_text)
            .filter(|value| !value.trim().is_empty()),
        product_type: order.get("product_type").and_then(value_to_i64),
    }
}

fn parse_sponsor_item(item: &Value) -> AfdianSponsorItem {
    let plan_names = item
        .get("sponsor_plans")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|plan| {
            plan.get("name")
                .or_else(|| plan.pointer("/plan/name"))
                .and_then(value_to_text)
        })
        .collect();
    AfdianSponsorItem {
        id: item
            .pointer("/user/user_id")
            .and_then(value_to_text)
            .unwrap_or_else(|| "unknown".into()),
        name: item
            .pointer("/user/name")
            .and_then(value_to_text)
            .unwrap_or_else(|| "爱发电用户".into()),
        avatar: item.pointer("/user/avatar").and_then(value_to_text),
        total_amount: item
            .get("all_sum_amount")
            .and_then(value_to_amount)
            .unwrap_or_else(|| "0".into()),
        first_sponsored_at: item
            .get("create_time")
            .and_then(|value| timestamp_to_rfc3339(value, &shanghai_timezone())),
        last_sponsored_at: item
            .get("last_pay_time")
            .and_then(|value| timestamp_to_rfc3339(value, &shanghai_timezone())),
        plan_names,
    }
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

fn aggregate_order_income(
    orders: &[Value],
    dashboard: &Value,
    now: DateTime<FixedOffset>,
) -> AfdianIncomeOverview {
    let month_key = now.format("%Y%m").to_string();
    let previous_month_key = now
        .date_naive()
        .with_day(1)
        .and_then(|date| date.pred_opt())
        .map(|date| date.format("%Y%m").to_string())
        .unwrap_or_default();
    let today_key = now.format("%Y%m%d").to_string();
    let yesterday_key = now
        .date_naive()
        .pred_opt()
        .map(|date| date.format("%Y%m%d").to_string())
        .unwrap_or_default();
    let timezone = *now.offset();
    let mut seen_orders = HashSet::new();
    let mut current_month = Decimal::ZERO;
    let mut previous_month = Decimal::ZERO;
    let mut today = Decimal::ZERO;
    let mut yesterday = Decimal::ZERO;

    for order in orders {
        if let Some(identity) = order_identity(order) {
            if !seen_orders.insert(identity) {
                continue;
            }
        }
        if !is_income_order(order) {
            continue;
        }
        let Some(date_key) = order_date_key(order, &timezone) else {
            continue;
        };
        let Some(amount) = order
            .get("total_amount")
            .and_then(value_to_amount)
            .and_then(|value| parse_decimal(&value))
        else {
            continue;
        };

        if date_key.starts_with(&month_key) {
            current_month += amount;
        } else if date_key.starts_with(&previous_month_key) {
            previous_month += amount;
        }
        if date_key == today_key {
            today += amount;
        } else if date_key == yesterday_key {
            yesterday += amount;
        }
    }

    AfdianIncomeOverview {
        current_month: Some(format_decimal(current_month)),
        previous_month: format_decimal(previous_month),
        withdrawable: dashboard
            .pointer("/data/balance_after_tax")
            .and_then(value_to_amount),
        today: format_decimal(today),
        yesterday: format_decimal(yesterday),
        as_of: now.to_rfc3339(),
    }
}

fn is_income_order(order: &Value) -> bool {
    matches!(order.get("status").and_then(value_to_i64), Some(2 | 8 | 9))
}

fn order_identity(order: &Value) -> Option<String> {
    order
        .get("out_trade_no")
        .or_else(|| order.get("id"))
        .and_then(|value| match value {
            Value::String(raw) if !raw.trim().is_empty() => Some(raw.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
}

fn order_date_key(order: &Value, timezone: &FixedOffset) -> Option<String> {
    let timestamp = order.get("create_time").and_then(value_to_timestamp)?;
    DateTime::<Utc>::from_timestamp(timestamp, 0)
        .map(|date| date.with_timezone(timezone).format("%Y%m%d").to_string())
}

fn shanghai_timezone() -> FixedOffset {
    FixedOffset::east_opt(8 * 60 * 60).expect("固定时区有效")
}

fn timestamp_to_rfc3339(value: &Value, timezone: &FixedOffset) -> Option<String> {
    let timestamp = value_to_timestamp(value)?;
    DateTime::<Utc>::from_timestamp(timestamp, 0)
        .map(|date| date.with_timezone(timezone).to_rfc3339())
}

fn normalize_date_key(value: &str) -> Option<String> {
    let digits: String = value.chars().filter(char::is_ascii_digit).take(8).collect();
    (digits.len() == 8).then_some(digits)
}

fn value_to_timestamp(value: &Value) -> Option<i64> {
    let raw = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))?;
    if !raw.is_finite() || raw <= 0.0 {
        return None;
    }
    let seconds = if raw >= 10_000_000_000.0 {
        raw / 1_000.0
    } else {
        raw
    };
    Some(seconds.floor() as i64)
}

fn value_to_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(raw) if !raw.trim().is_empty() => Some(raw.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn parse_decimal(value: &str) -> Option<Decimal> {
    Decimal::from_str(value.trim().replace(',', "").as_str()).ok()
}

fn format_decimal(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
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

fn session_path() -> Result<&'static Path, String> {
    AFDIAN_SESSION_PATH
        .get()
        .map(PathBuf::as_path)
        .ok_or_else(|| "爱发电会话存储未初始化".to_string())
}

fn load_persisted_session() -> Result<Option<StoredSession>, String> {
    load_session_file(session_path()?)
}

fn load_session_file(path: &Path) -> Result<Option<StoredSession>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|_| "爱发电登录凭据已损坏，请重新登录".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取爱发电会话：{error}")),
    }
}

fn save_persisted_session(session: &StoredSession) -> Result<(), String> {
    save_session_file(session_path()?, session)
}

fn save_session_file(path: &Path, session: &StoredSession) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "爱发电会话存储路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建会话存储目录：{error}"))?;
    let raw = serde_json::to_vec(session).map_err(|_| "无法保存爱发电登录状态".to_string())?;
    write_session_file(path, &raw)
}

fn clear_persisted_session() -> Result<(), String> {
    clear_session_file(session_path()?)
}

fn clear_session_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法清除爱发电会话：{error}")),
    }
}

#[cfg(unix)]
fn write_session_file(path: &Path, raw: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| format!("无法写入爱发电会话：{error}"))?;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("无法限制爱发电会话文件权限：{error}"))?;
    file.write_all(raw)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("无法写入爱发电会话：{error}"))
}

#[cfg(not(unix))]
fn write_session_file(path: &Path, raw: &[u8]) -> Result<(), String> {
    fs::write(path, raw).map_err(|error| format!("无法写入爱发电会话：{error}"))
}

fn session_cache() -> &'static Mutex<SessionCache> {
    AFDIAN_SESSION_CACHE.get_or_init(|| Mutex::new(SessionCache::default()))
}

fn load_session() -> Result<Option<StoredSession>, String> {
    let mut cache = session_cache()
        .lock()
        .map_err(|_| "爱发电会话缓存不可用".to_string())?;
    if cache.loaded {
        return Ok(cache.session.clone());
    }

    let session = load_persisted_session()?;
    cache.loaded = true;
    cache.session = session.clone();
    Ok(session)
}

fn save_session(session: &StoredSession) -> Result<(), String> {
    let mut cache = session_cache()
        .lock()
        .map_err(|_| "爱发电会话缓存不可用".to_string())?;
    save_persisted_session(session)?;
    cache.loaded = true;
    cache.session = Some(session.clone());
    Ok(())
}

fn clear_session() -> Result<(), String> {
    let mut cache = session_cache()
        .lock()
        .map_err(|_| "爱发电会话缓存不可用".to_string())?;
    clear_persisted_session()?;
    cache.loaded = true;
    cache.session = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    #[test]
    fn calculates_income_from_paid_orders() {
        let timezone = FixedOffset::east_opt(8 * 60 * 60).unwrap();
        let now = timezone.with_ymd_and_hms(2026, 8, 30, 12, 0, 0).unwrap();
        let orders = vec![
            json!({
                "out_trade_no": "today-1",
                "status": 2,
                "create_time": timezone.with_ymd_and_hms(2026, 8, 30, 9, 0, 0).unwrap().timestamp(),
                "total_amount": "10.00"
            }),
            json!({
                "out_trade_no": "today-2",
                "status": "8",
                "create_time": timezone.with_ymd_and_hms(2026, 8, 30, 10, 0, 0).unwrap().timestamp_millis(),
                "total_amount": "12.00"
            }),
            json!({
                "out_trade_no": "yesterday",
                "status": 9,
                "create_time": timezone.with_ymd_and_hms(2026, 8, 29, 23, 0, 0).unwrap().timestamp(),
                "total_amount": 8.5
            }),
            json!({
                "out_trade_no": "month",
                "status": 2,
                "create_time": timezone.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap().timestamp(),
                "total_amount": "1.20"
            }),
            json!({
                "out_trade_no": "previous-month",
                "status": 2,
                "create_time": timezone.with_ymd_and_hms(2026, 7, 31, 23, 0, 0).unwrap().timestamp(),
                "total_amount": "40.00"
            }),
        ];
        let dashboard = json!({ "data": { "balance_after_tax": "0.00" } });

        let overview = aggregate_order_income(&orders, &dashboard, now);

        assert_eq!(overview.current_month.as_deref(), Some("31.7"));
        assert_eq!(overview.previous_month, "40");
        assert_eq!(overview.withdrawable.as_deref(), Some("0.00"));
        assert_eq!(overview.today, "22");
        assert_eq!(overview.yesterday, "8.5");
        assert_eq!(overview.as_of, "2026-08-30T12:00:00+08:00");
    }

    #[test]
    fn defaults_missing_order_income_to_zero() {
        let timezone = FixedOffset::east_opt(8 * 60 * 60).unwrap();
        let now = timezone.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let overview = aggregate_order_income(&[], &json!({ "data": {} }), now);

        assert_eq!(overview.current_month.as_deref(), Some("0"));
        assert_eq!(overview.previous_month, "0");
        assert_eq!(overview.withdrawable, None);
        assert_eq!(overview.today, "0");
        assert_eq!(overview.yesterday, "0");
    }

    #[test]
    fn excludes_invalid_and_duplicate_orders() {
        let timezone = FixedOffset::east_opt(8 * 60 * 60).unwrap();
        let timestamp = timezone
            .with_ymd_and_hms(2026, 8, 30, 10, 0, 0)
            .unwrap()
            .timestamp();
        let orders = vec![
            json!({ "out_trade_no": "paid", "status": 2, "create_time": timestamp, "total_amount": "22" }),
            json!({ "out_trade_no": "paid", "status": 2, "create_time": timestamp, "total_amount": "22" }),
            json!({ "out_trade_no": "pending", "status": 1, "create_time": timestamp, "total_amount": "100" }),
            json!({ "out_trade_no": "refunded", "status": 3, "create_time": timestamp, "total_amount": "100" }),
            json!({ "out_trade_no": "invalid", "status": 2, "create_time": timestamp, "total_amount": "invalid" }),
        ];
        let now = timezone.with_ymd_and_hms(2026, 8, 30, 20, 0, 0).unwrap();
        let dashboard = json!({ "data": { "balance_after_tax": 20.68 } });

        let overview = aggregate_order_income(&orders, &dashboard, now);

        assert_eq!(overview.today, "22");
        assert_eq!(overview.current_month.as_deref(), Some("22"));
        assert_eq!(overview.withdrawable.as_deref(), Some("20.68"));
    }

    #[test]
    fn parses_management_order_and_sponsor_items() {
        let timestamp = 1_788_060_000;
        let order = parse_received_order(&json!({
            "out_trade_no": "order-1",
            "title": "发电商品",
            "total_amount": "22.50",
            "status": 2,
            "create_time": timestamp,
            "product_type": 1,
            "user": { "name": "赞助者", "avatar": "https://example.com/avatar.png" },
            "plan": { "name": "支持计划" },
            "remark": "加油"
        }));
        let sponsor = parse_sponsor_item(&json!({
            "all_sum_amount": "100.00",
            "create_time": timestamp,
            "last_pay_time": timestamp,
            "user": { "user_id": "user-1", "name": "赞助者" },
            "sponsor_plans": [{ "name": "支持计划" }]
        }));

        assert_eq!(order.id, "order-1");
        assert_eq!(order.amount, "22.50");
        assert_eq!(order.sponsor_name, "赞助者");
        assert_eq!(order.plan_name.as_deref(), Some("支持计划"));
        assert_eq!(sponsor.id, "user-1");
        assert_eq!(sponsor.total_amount, "100.00");
        assert_eq!(sponsor.plan_names, vec!["支持计划"]);
        assert!(sponsor.last_sponsored_at.is_some());
    }

    #[test]
    fn normalizes_management_dates_and_timestamps() {
        let timezone = shanghai_timezone();
        let timestamp = json!(1_788_060_000_000_i64);

        assert_eq!(normalize_date_key("2026-08-30"), Some("20260830".into()));
        assert!(timestamp_to_rfc3339(&timestamp, &timezone)
            .is_some_and(|value| value.ends_with("+08:00")));
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

    #[test]
    fn persists_session_in_app_private_storage() {
        let directory = std::env::temp_dir().join(format!(
            "astrobox-afdian-session-{}-{}",
            std::process::id(),
            OsRng.next_u64()
        ));
        let path = directory.join(AFDIAN_SESSION_FILE_NAME);
        let session = StoredSession {
            auth_token: "test-token".into(),
            display_name: "测试用户".into(),
        };

        assert!(load_session_file(&path).unwrap().is_none());
        save_session_file(&path, &session).unwrap();
        let restored = load_session_file(&path).unwrap().unwrap();

        assert_eq!(restored.auth_token, "test-token");
        assert_eq!(restored.display_name, "测试用户");

        let replacement = StoredSession {
            auth_token: "replacement-token".into(),
            display_name: "替换用户".into(),
        };
        save_session_file(&path, &replacement).unwrap();
        let restored = load_session_file(&path).unwrap().unwrap();

        assert_eq!(restored.auth_token, "replacement-token");
        assert_eq!(restored.display_name, "替换用户");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        clear_session_file(&path).unwrap();
        clear_session_file(&path).unwrap();
        assert!(!path.exists());
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn rejects_corrupted_session_file() {
        let directory = std::env::temp_dir().join(format!(
            "astrobox-afdian-corrupted-session-{}-{}",
            std::process::id(),
            OsRng.next_u64()
        ));
        let path = directory.join(AFDIAN_SESSION_FILE_NAME);
        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, b"invalid-session").unwrap();

        assert_eq!(
            load_session_file(&path).unwrap_err(),
            "爱发电登录凭据已损坏，请重新登录"
        );

        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
