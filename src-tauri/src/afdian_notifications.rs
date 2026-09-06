use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

use crate::{afdian, AppHttpClient};

const POLL_INTERVAL: Duration = Duration::from_secs(60);
const RETRY_INTERVAL: Duration = Duration::from_secs(90);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_INDIVIDUAL_NOTIFICATIONS: usize = 3;
pub(crate) const DIALOGS_REFRESHED_EVENT: &str = "afdian-message-dialogs-refreshed";

#[derive(Default)]
struct NotificationRuntimeState {
    enabled: bool,
    initialized: bool,
    latest_by_user: HashMap<String, String>,
    active_user_id: Option<String>,
    app_focused: bool,
}

#[derive(Clone)]
pub(crate) struct AfdianNotificationManager {
    state: Arc<Mutex<NotificationRuntimeState>>,
    wake: Arc<Notify>,
}

impl AfdianNotificationManager {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(NotificationRuntimeState::default())),
            wake: Arc::new(Notify::new()),
        }
    }

    fn is_enabled(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.enabled)
            .unwrap_or(false)
    }
}

#[derive(Debug)]
struct NotificationCandidate {
    user_id: String,
    body: String,
}

#[derive(Debug)]
struct ReconcileResult {
    candidates: Vec<NotificationCandidate>,
    dialog_count: usize,
    unread_dialog_count: usize,
    established_baseline: bool,
}

pub(crate) fn initialize<R: Runtime>(app: &mut tauri::App<R>) {
    let manager = AfdianNotificationManager::new();
    app.manage(manager.clone());

    let app_handle = app.handle().clone();
    let http_client = app.state::<AppHttpClient>().0.clone();
    tauri::async_runtime::spawn(run_worker(app_handle, http_client, manager));
}

#[tauri::command]
pub(crate) fn afdian_message_notifications_set_enabled(
    manager: State<'_, AfdianNotificationManager>,
    enabled: bool,
) -> Result<(), String> {
    let changed = {
        let mut state = manager
            .state
            .lock()
            .map_err(|_| "爱发电通知状态不可用".to_string())?;
        if state.enabled == enabled {
            false
        } else {
            state.enabled = enabled;
            state.initialized = false;
            state.latest_by_user.clear();
            true
        }
    };

    log::info!(
        target: "afdian/notifications",
        "后台私信通知开关同步完成 enabled={enabled} changed={changed}"
    );
    if changed {
        manager.wake.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn afdian_message_notifications_set_context(
    manager: State<'_, AfdianNotificationManager>,
    active_user_id: Option<String>,
    app_focused: bool,
) -> Result<(), String> {
    let normalized_user_id = active_user_id.filter(|value| !value.trim().is_empty());
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "爱发电通知状态不可用".to_string())?;
    state.active_user_id = normalized_user_id;
    state.app_focused = app_focused;
    Ok(())
}

async fn run_worker<R: Runtime>(
    app: AppHandle<R>,
    http_client: reqwest::Client,
    manager: AfdianNotificationManager,
) {
    log::info!(
        target: "afdian/notifications",
        "爱发电私信后台轮询任务已启动 interval_seconds={} retry_seconds={}",
        POLL_INTERVAL.as_secs(),
        RETRY_INTERVAL.as_secs()
    );

    loop {
        if !manager.is_enabled() {
            manager.wake.notified().await;
            continue;
        }

        let started_at = Instant::now();
        log::info!(target: "afdian/notifications", "开始后台同步爱发电私信列表");

        let next_interval = match tokio::time::timeout(
            REQUEST_TIMEOUT,
            afdian::fetch_message_dialogs(&http_client, 1),
        )
        .await
        {
            Ok(Ok(page)) => {
                let result = reconcile_dialogs(&page.items, &manager);
                let elapsed = started_at.elapsed().as_millis();
                log::info!(
                    target: "afdian/notifications",
                    "后台私信同步完成 dialogs={} unread_dialogs={} candidates={} baseline={} elapsed_ms={elapsed}",
                    result.dialog_count,
                    result.unread_dialog_count,
                    result.candidates.len(),
                    result.established_baseline
                );

                if let Err(error) = app.emit(DIALOGS_REFRESHED_EVENT, ()) {
                    log::warn!(
                        target: "afdian/notifications",
                        "发送私信列表刷新事件失败 error={error}"
                    );
                }

                if manager.is_enabled() {
                    send_notifications(&app, &manager, result.candidates);
                }
                POLL_INTERVAL
            }
            Ok(Err(error)) => {
                log::warn!(
                    target: "afdian/notifications",
                    "后台私信同步失败 error={error} retry_seconds={}",
                    RETRY_INTERVAL.as_secs()
                );
                RETRY_INTERVAL
            }
            Err(_) => {
                log::warn!(
                    target: "afdian/notifications",
                    "后台私信同步超时 timeout_seconds={} retry_seconds={}",
                    REQUEST_TIMEOUT.as_secs(),
                    RETRY_INTERVAL.as_secs()
                );
                RETRY_INTERVAL
            }
        };

        tokio::select! {
            _ = tokio::time::sleep(next_interval) => {}
            _ = manager.wake.notified() => {}
        }
    }
}

fn reconcile_dialogs(
    dialogs: &[afdian::AfdianDialogItem],
    manager: &AfdianNotificationManager,
) -> ReconcileResult {
    let Ok(mut state) = manager.state.lock() else {
        log::warn!(target: "afdian/notifications", "无法读取后台私信通知状态");
        return ReconcileResult {
            candidates: Vec::new(),
            dialog_count: dialogs.len(),
            unread_dialog_count: 0,
            established_baseline: false,
        };
    };
    if !state.enabled {
        return ReconcileResult {
            candidates: Vec::new(),
            dialog_count: dialogs.len(),
            unread_dialog_count: 0,
            established_baseline: false,
        };
    }

    let established_baseline = !state.initialized;
    let previous = std::mem::take(&mut state.latest_by_user);
    let mut latest_by_user = HashMap::new();
    let mut candidates = Vec::new();
    let mut unread_dialog_count = 0;

    for dialog in dialogs {
        let Some(message_id) = dialog
            .latest_message_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        if dialog.unread_count > 0 {
            unread_dialog_count += 1;
        }
        latest_by_user.insert(dialog.user.user_id.clone(), message_id.to_string());

        let message_changed = previous
            .get(&dialog.user.user_id)
            .map_or(true, |previous_id| previous_id != message_id);
        if state.initialized && message_changed && dialog.unread_count > 0 {
            let user_name = if dialog.user.name.trim().is_empty() {
                "爱发电用户"
            } else {
                dialog.user.name.trim()
            };
            let preview = normalize_preview(dialog.preview.as_deref());
            let body = if preview.is_empty() {
                format!("{user_name}发来一条新消息")
            } else {
                format!("{user_name}：{preview}")
            };
            candidates.push(NotificationCandidate {
                user_id: dialog.user.user_id.clone(),
                body,
            });
        }
    }

    state.latest_by_user = latest_by_user;
    state.initialized = true;
    ReconcileResult {
        candidates,
        dialog_count: dialogs.len(),
        unread_dialog_count,
        established_baseline,
    }
}

fn send_notifications<R: Runtime>(
    app: &AppHandle<R>,
    manager: &AfdianNotificationManager,
    candidates: Vec<NotificationCandidate>,
) {
    if candidates.is_empty() {
        return;
    }

    let visible_candidates = match manager.state.lock() {
        Ok(state) => candidates
            .into_iter()
            .filter(|candidate| {
                !(state.app_focused
                    && state.active_user_id.as_deref() == Some(candidate.user_id.as_str()))
            })
            .collect::<Vec<_>>(),
        Err(_) => candidates,
    };
    if visible_candidates.is_empty() {
        log::info!(
            target: "afdian/notifications",
            "新私信来自当前正在查看的会话，已跳过系统通知"
        );
        return;
    }

    let notification_count = visible_candidates.len();
    let result = if notification_count > MAX_INDIVIDUAL_NOTIFICATIONS {
        app.notification()
            .builder()
            .title("爱发电新私信")
            .body(format!("你收到了 {notification_count} 个对话的新私信"))
            .show()
    } else {
        visible_candidates.into_iter().try_for_each(|candidate| {
            app.notification()
                .builder()
                .title("爱发电新私信")
                .body(candidate.body)
                .show()
        })
    };

    match result {
        Ok(()) => log::info!(
            target: "afdian/notifications",
            "系统通知发送完成 count={notification_count}"
        ),
        Err(error) => log::warn!(
            target: "afdian/notifications",
            "系统通知发送失败 count={notification_count} error={error}"
        ),
    }
}

fn normalize_preview(value: Option<&str>) -> String {
    let mut without_tags = String::new();
    let mut inside_tag = false;
    for character in value.unwrap_or_default().chars() {
        match character {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                without_tags.push(' ');
            }
            _ if !inside_tag => without_tags.push(character),
            _ => {}
        }
    }

    let normalized = without_tags
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut characters = normalized.chars();
    let preview = characters.by_ref().take(120).collect::<String>();
    if characters.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dialog(message_id: &str, unread_count: i64) -> afdian::AfdianDialogItem {
        afdian::AfdianDialogItem {
            latest_message_id: Some(message_id.to_string()),
            unread_count,
            total_count: 1,
            status: None,
            user: afdian::AfdianDialogUser {
                user_id: "user-1".to_string(),
                name: "测试用户".to_string(),
                avatar: None,
            },
            preview: Some("<p>你好</p>".to_string()),
            sent_at: None,
        }
    }

    fn enabled_manager() -> AfdianNotificationManager {
        let manager = AfdianNotificationManager::new();
        manager.state.lock().unwrap().enabled = true;
        manager
    }

    #[test]
    fn first_sync_only_establishes_baseline() {
        let manager = enabled_manager();
        let result = reconcile_dialogs(&[dialog("1", 1)], &manager);

        assert!(result.established_baseline);
        assert!(result.candidates.is_empty());
    }

    #[test]
    fn changed_unread_message_creates_candidate() {
        let manager = enabled_manager();
        reconcile_dialogs(&[dialog("1", 0)], &manager);
        let result = reconcile_dialogs(&[dialog("2", 1)], &manager);

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].body, "测试用户：你好");
    }

    #[test]
    fn unchanged_message_does_not_create_candidate() {
        let manager = enabled_manager();
        reconcile_dialogs(&[dialog("1", 1)], &manager);
        let result = reconcile_dialogs(&[dialog("1", 1)], &manager);

        assert!(result.candidates.is_empty());
    }
}
