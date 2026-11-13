use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

use crate::{append_log, stop_desktop_server};

/// 安装包启动时调用。大版本更新由系统对话框拦住，编辑器页面不会先打开。
/// 开发调试不拦截。返回 true 时调用方不要再显示主窗口。
pub fn block_if_major(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> bool {
    #[cfg(any(debug_assertions, not(any(target_os = "macos", target_os = "windows"))))]
    {
        let _ = (app, window);
        false
    }
    #[cfg(all(not(debug_assertions), any(target_os = "macos", target_os = "windows")))]
    {
        match tauri::async_runtime::block_on(find_major_update(app)) {
            Ok(Some(update)) => {
                append_log(&format!(
                    "major update {} -> {}, blocking in the shell",
                    update.current_version, update.version
                ));
                begin_required_update(app.clone(), window.clone(), update);
                true
            }
            Ok(None) => false,
            Err(err) => {
                append_log(&format!("skip major update check: {err}"));
                false
            }
        }
    }
}

/// 页面里点「检查更新」时，如果已经是大版本，把拦住和安装交回原生壳。
/// 返回 true 表示壳已经接手（用户退出或即将重启）。
#[tauri::command]
pub async fn enforce_required_update(app: tauri::AppHandle) -> Result<bool, String> {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Ok(false);
    }
    let Some(update) = find_major_update(&app).await? else {
        return Ok(false);
    };
    let (tx, mut rx) = tauri::async_runtime::channel::<bool>(1);
    let handle = app.clone();
    handle.clone().run_on_main_thread(move || {
        let handled = if let Some(window) = handle.get_webview_window("main") {
            begin_required_update(handle.clone(), window, update);
            true
        } else {
            false
        };
        let _ = tx.blocking_send(handled);
    })
    .map_err(|err| err.to_string())?;
    Ok(rx.recv().await.unwrap_or(false))
}

fn version_major(version: &str) -> Option<u64> {
    let trimmed = version.trim();
    let trimmed = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    let (head, _) = trimmed.split_once('.')?;
    if head.is_empty() || !head.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    head.parse().ok()
}

fn is_major_upgrade(current: &str, next: &str) -> bool {
    match (version_major(current), version_major(next)) {
        (Some(from), Some(to)) => to > from,
        _ => false,
    }
}

async fn find_major_update(app: &tauri::AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|err| err.to_string())?;
    let update = updater.check().await.map_err(|err| err.to_string())?;
    Ok(update.filter(|update| is_major_upgrade(&update.current_version, &update.version)))
}

/// 系统对话框确认后才下载。下载放在后台，主线程可以刷新进度窗口。
fn begin_required_update(app: tauri::AppHandle, window: tauri::WebviewWindow, update: tauri_plugin_updater::Update) {
    let copy = Copy::from_system();
    if !ask(&copy.title, &copy.prompt(&update.version), &copy.update_now, &copy.quit) {
        leave(&app);
        return;
    }
    reveal_progress(&window, copy.downloading_unknown);
    let update_for_retry = update.clone();
    let app_for_download = app.clone();
    let window_for_download = window.clone();
    tauri::async_runtime::spawn(async move {
        let result = download_required(window_for_download.clone(), update, copy).await;
        let _ = app_for_download.clone().run_on_main_thread(move || match result {
            Ok(()) => {
                set_progress_text(&window_for_download, copy.installing);
                stop_desktop_server(&app_for_download);
                app_for_download.restart();
            }
            Err(err) => {
                append_log(&format!("required update failed: {err}"));
                if !ask(&copy.failed_title, &copy.failed(&err), &copy.retry, &copy.quit) {
                    leave(&app_for_download);
                    return;
                }
                begin_required_update(app_for_download, window_for_download, update_for_retry);
            }
        });
    });
}

fn leave(app: &tauri::AppHandle) {
    stop_desktop_server(app);
    app.exit(0);
}

async fn download_required(
    window: tauri::WebviewWindow,
    update: tauri_plugin_updater::Update,
    copy: Copy,
) -> Result<(), String> {
    let mut got: u64 = 0;
    let progress_window = window.clone();
    let chunk_copy = copy;
    let done_window = window;
    let done_copy = copy;
    update
        .download_and_install(
            move |chunk, total| {
                got += chunk as u64;
                let text = match total {
                    Some(total) if total > 0 => {
                        let percent = (got.saturating_mul(100) / total).min(99);
                        chunk_copy.downloading(percent)
                    }
                    _ => chunk_copy.downloading_unknown.to_string(),
                };
                set_progress_text(&progress_window, &text);
            },
            move || set_progress_text(&done_window, done_copy.installing),
        )
        .await
        .map_err(|err| err.to_string())
}

fn reveal_progress(window: &tauri::WebviewWindow, message: &str) {
    match progress_page_url(message) {
        Ok(url) => {
            if let Err(err) = window.navigate(url) {
                append_log(&format!("progress page navigate failed: {err}"));
            }
        }
        Err(err) => append_log(&format!("progress page url failed: {err}")),
    }
    let _ = window.set_closable(false);
    set_progress_text(window, message);
    let _ = window.show();
    let _ = window.set_focus();
}

fn set_progress_text(window: &tauri::WebviewWindow, text: &str) {
    let _ = window.set_title(text);
    let quoted = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string());
    let _ = window.eval(format!(
        "var el=document.getElementById('status');if(el)el.textContent={quoted};"
    ));
}

fn progress_page_url(message: &str) -> Result<tauri::Url, String> {
    let quoted = serde_json::to_string(message).unwrap_or_else(|_| "\"\"".to_string());
    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;background:#fff;color:#1a1a1a;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
body{{display:flex;align-items:center;justify-content:center}}p{{margin:0}}
</style></head><body><p id="status"></p><script>document.getElementById("status").textContent={quoted};</script></body></html>"#
    );
    let url = format!("data:text/html;base64,{}", STANDARD.encode(html.as_bytes()));
    url.parse::<tauri::Url>().map_err(|err| err.to_string())
}

/// 系统对话框。macOS 用自定义按钮；Windows 没有自定义按钮时退回「确定 / 取消」，正文里写明含义。
fn ask(title: &str, message: &str, ok_label: &str, cancel_label: &str) -> bool {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let result = rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Warning)
            .set_title(title)
            .set_description(message)
            .set_buttons(rfd::MessageButtons::OkCancelCustom(ok_label.to_string(), cancel_label.to_string()))
            .show();
        return match result {
            rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes => true,
            rfd::MessageDialogResult::Custom(label) => label == ok_label,
            _ => false,
        };
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (title, message, ok_label, cancel_label);
        false
    }
}

#[derive(Clone, Copy)]
struct Copy {
    title: &'static str,
    update_now: &'static str,
    quit: &'static str,
    retry: &'static str,
    failed_title: &'static str,
    downloading_unknown: &'static str,
    installing: &'static str,
    prompt_body: &'static str,
    prompt_hint: &'static str,
    failed_hint: &'static str,
    downloading_prefix: &'static str,
}

impl Copy {
    fn from_system() -> Self {
        if ui_is_zh() { Self::zh() } else { Self::en() }
    }

    fn zh() -> Self {
        Self {
            title: "当前版本已停止支持",
            update_now: "立即更新",
            quit: "退出",
            retry: "重试",
            failed_title: "更新失败",
            downloading_unknown: "正在下载更新…",
            installing: "正在安装，即将重启",
            prompt_body: "旧版本已不能继续使用，请更新到 {version} 后再使用。",
            prompt_hint: "确定后开始下载并安装，取消将退出应用。",
            failed_hint: "确定后重试，取消将退出应用。",
            downloading_prefix: "正在下载",
        }
    }

    fn en() -> Self {
        Self {
            title: "This version is no longer supported",
            update_now: "Update now",
            quit: "Quit",
            retry: "Try again",
            failed_title: "Update failed",
            downloading_unknown: "Downloading the update…",
            installing: "Installing, then restarting",
            prompt_body: "The installed version can no longer be used. Update to {version} to continue.",
            prompt_hint: "OK downloads and installs the update. Cancel quits the app.",
            failed_hint: "OK tries again. Cancel quits the app.",
            downloading_prefix: "Downloading",
        }
    }

    fn prompt(&self, version: &str) -> String {
        let body = self.prompt_body.replace("{version}", version);
        if cfg!(target_os = "macos") {
            body
        } else {
            format!("{body}\n\n{}", self.prompt_hint)
        }
    }

    fn failed(&self, err: &str) -> String {
        if cfg!(target_os = "macos") {
            err.to_string()
        } else {
            format!("{err}\n\n{}", self.failed_hint)
        }
    }

    fn downloading(&self, percent: u64) -> String {
        format!("{} {percent}%", self.downloading_prefix)
    }
}

fn ui_is_zh() -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(detect_ui_zh)
}

fn detect_ui_zh() -> bool {
    #[cfg(target_os = "macos")]
    if let Some(lang) = apple_language() {
        return lang.to_lowercase().starts_with("zh");
    }
    #[cfg(target_os = "windows")]
    if let Some(lang) = windows_locale_name() {
        return lang.to_lowercase().starts_with("zh");
    }
    std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_default()
        .to_lowercase()
        .starts_with("zh")
}

#[cfg(target_os = "macos")]
fn apple_language() -> Option<String> {
    let output = Command::new("defaults").args(["read", "-g", "AppleLanguages"]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let start = text.find('"')? + 1;
    let end = start + text[start..].find('"')?;
    Some(text[start..end].to_string())
}

#[cfg(target_os = "windows")]
fn windows_locale_name() -> Option<String> {
    let output = Command::new("reg")
        .args(["query", r"HKCU\Control Panel\International", "/v", "LocaleName"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace()
        .rev()
        .find(|token| token.contains('-') || token.contains('_'))
        .map(|token| token.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_major_upgrade;

    #[test]
    fn major_only_when_the_first_component_grows() {
        assert!(is_major_upgrade("0.0.27", "1.0.0"));
        assert!(is_major_upgrade("v0.0.27", "1.0.0"));
        assert!(!is_major_upgrade("0.0.27", "0.0.28"));
        assert!(!is_major_upgrade("0.0.27", "0.1.0"));
        assert!(!is_major_upgrade("1.2.3", "1.9.0"));
        assert!(!is_major_upgrade("1.0.0", "1.0.0"));
        assert!(!is_major_upgrade("nope", "1.0.0"));
    }
}
