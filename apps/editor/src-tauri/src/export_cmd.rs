use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::AppHandle;

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn pick_save_path_desktop(suggested_name: String, extension: String) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_file_name(&suggested_name);
    if !extension.is_empty() {
        dialog = dialog.add_filter(&extension.to_uppercase(), &[extension.as_str()]);
    }
    let Some(path) = dialog.save_file() else {
        return Ok(None);
    };
    Ok(Some(ensure_extension(path, &extension).to_string_lossy().into_owned()))
}

fn ensure_extension(path: PathBuf, extension: &str) -> PathBuf {
    if extension.is_empty() {
        return path;
    }
    match path.extension().and_then(|value| value.to_str()) {
        Some(current) if current.eq_ignore_ascii_case(extension) => path,
        _ => {
            let mut name = path.file_name().map(|value| value.to_os_string()).unwrap_or_default();
            name.push(".");
            name.push(extension);
            path.with_file_name(name)
        }
    }
}

/// 弹出系统保存框。取消时返回 null，不报错。
#[tauri::command]
pub fn pick_save_path(suggested_name: String, extension: String) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        pick_save_path_desktop(suggested_name, extension)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (suggested_name, extension);
        Err("SAVE_UNSUPPORTED".into())
    }
}

/// 把前端传来的 base64 写到用户选定的路径。
#[tauri::command]
pub fn write_export_file(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data.trim()).map_err(|err| err.to_string())?;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    std::fs::write(&path, bytes).map_err(|err| err.to_string())
}

/// 先选保存位置，再把正文印成 PDF。非 macOS 返回 PDF_UNSUPPORTED，由页面改走打印。
#[tauri::command]
pub async fn export_pdf(app: AppHandle, suggested_name: String, html: String) -> Result<bool, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, suggested_name, html);
        return Err("PDF_UNSUPPORTED".into());
    }
    #[cfg(target_os = "macos")]
    {
        let path = pick_on_main(&app, suggested_name, "pdf".into())?;
        let Some(path) = path else {
            return Ok(false);
        };
        write_pdf_file(&app, html, PathBuf::from(path)).await?;
        Ok(true)
    }
}

#[cfg(target_os = "macos")]
fn pick_on_main(app: &AppHandle, suggested_name: String, extension: String) -> Result<Option<String>, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(pick_save_path_desktop(suggested_name, extension));
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|_| "保存对话框没有打开".to_string())?
}

#[cfg(target_os = "macos")]
async fn write_pdf_file(app: &AppHandle, html: String, path: PathBuf) -> Result<(), String> {
    use tauri::Manager;

    let (tx, rx) = mpsc::channel();
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(err) = start_pdf_window(&app_handle, html, path, tx.clone()) {
            let _ = tx.send(Err(err));
        }
    })
    .map_err(|err| err.to_string())?;

    let outcome = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(20)))
        .await
        .map_err(|err| err.to_string())?;
    let _ = app.get_webview_window("pdf-export").map(|window| window.close());
    match outcome {
        Ok(result) => result,
        Err(_) => Err("导出 PDF 超时".into()),
    }
}

/// 短文档直接用 data URL 打开，一次加载完成就能印。太长的改在空白页里写入，避免地址超限。
#[cfg(target_os = "macos")]
fn data_url(html: &str) -> Option<tauri::Url> {
    use base64::Engine;
    let encoded = STANDARD.encode(html.as_bytes());
    if encoded.len() > 1_500_000 {
        return None;
    }
    format!("data:text/html;base64,{encoded}").parse().ok()
}

#[cfg(target_os = "macos")]
fn start_pdf_window(
    app: &AppHandle,
    html: String,
    path: PathBuf,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(existing) = app.get_webview_window("pdf-export") {
        let _ = existing.close();
    }
    let inject = if data_url(&html).is_some() { None } else { Some(html.clone()) };
    let url = data_url(&html).unwrap_or_else(|| "about:blank".parse().expect("about:blank"));
    let once = Arc::new(AtomicBool::new(false));
    let app_handle = app.clone();
    let window = WebviewWindowBuilder::new(app, "pdf-export", WebviewUrl::External(url))
        .title("导出 PDF")
        .inner_size(794.0, 1123.0)
        .position(0.0, 0.0)
        .visible(true)
        .focused(false)
        .skip_taskbar(true)
        .on_page_load(move |window, payload| {
            use tauri::webview::PageLoadEvent;
            if !matches!(payload.event(), PageLoadEvent::Finished) || once.swap(true, Ordering::SeqCst) {
                return;
            }
            let path = path.clone();
            let tx = tx.clone();
            let app_handle = app_handle.clone();
            let window = window.clone();
            let inject = inject.clone();
            thread::spawn(move || {
                if let Some(html) = inject {
                    if let Err(err) = inject_html(&app_handle, &window, &html) {
                        let _ = tx.send(Err(err));
                        close_on_main(&app_handle, window);
                        return;
                    }
                } else {
                    thread::sleep(Duration::from_millis(120));
                }
                let _ = tx.send(print_on_main(&app_handle, &window, &path));
            });
        })
        .build()
        .map_err(|err| err.to_string())?;
    let _ = window.with_webview(hide_export_window);
    Ok(())
}

#[cfg(target_os = "macos")]
fn hide_export_window(webview: tauri::webview::PlatformWebview) {
    use objc2::runtime::AnyObject;
    use objc2_web_kit::WKWebView;

    unsafe {
        let view = &*webview.inner().cast::<WKWebView>();
        let window: *mut AnyObject = objc2::msg_send![view, window];
        if !window.is_null() {
            let _: () = objc2::msg_send![window, setAlphaValue: 0.0_f64];
        }
    }
}

#[cfg(target_os = "macos")]
fn close_on_main(app: &AppHandle, window: tauri::WebviewWindow) {
    let _ = app.run_on_main_thread(move || {
        let _ = window.close();
    });
}

#[cfg(target_os = "macos")]
fn inject_html(app: &AppHandle, window: &tauri::WebviewWindow, html: &str) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let window_for_load = window.clone();
    let html = html.to_string();
    app.run_on_main_thread(move || {
        let result = window_for_load
            .with_webview(move |webview| load_html(webview, &html))
            .map_err(|err| err.to_string());
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|_| "导出窗口已关闭".to_string())??;

    let mut quiet = 0u8;
    for _ in 0..40 {
        thread::sleep(Duration::from_millis(40));
        if webview_loading(app, window)? {
            quiet = 0;
        } else {
            quiet += 1;
            if quiet >= 3 {
                break;
            }
        }
    }
    thread::sleep(Duration::from_millis(80));
    Ok(())
}

#[cfg(target_os = "macos")]
fn webview_loading(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<bool, String> {
    let (tx, rx) = mpsc::channel();
    let window = window.clone();
    app.run_on_main_thread(move || {
        let (flag_tx, flag_rx) = mpsc::channel();
        let _ = window.with_webview(move |webview| {
            use objc2_web_kit::WKWebView;
            let loading = unsafe {
                let view = &*webview.inner().cast::<WKWebView>();
                view.isLoading()
            };
            let _ = flag_tx.send(loading);
        });
        let _ = tx.send(flag_rx.recv().unwrap_or(false));
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|_| "导出窗口已关闭".to_string())
}

#[cfg(target_os = "macos")]
fn print_on_main(app: &AppHandle, window: &tauri::WebviewWindow, path: &Path) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let window = window.clone();
    let path = path.to_path_buf();
    app.run_on_main_thread(move || {
        let (flag_tx, flag_rx) = mpsc::channel();
        let webview_result = window.with_webview(move |webview| {
            let _ = flag_tx.send(print_to_pdf(webview, &path));
        });
        let result = match webview_result {
            Ok(()) => flag_rx.recv().unwrap_or(Err("导出 PDF 失败".into())),
            Err(err) => Err(err.to_string()),
        };
        let _ = window.close();
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|_| "导出窗口已关闭".to_string())?
}

#[cfg(target_os = "macos")]
fn load_html(webview: tauri::webview::PlatformWebview, html: &str) {
    use objc2_foundation::NSString;
    use objc2_web_kit::WKWebView;

    unsafe {
        let view = &*webview.inner().cast::<WKWebView>();
        let _ = view.loadHTMLString_baseURL(&NSString::from_str(html), None);
    }
}

#[cfg(target_os = "macos")]
fn print_to_pdf(webview: tauri::webview::PlatformWebview, path: &Path) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPrintInfo, NSPrintHeaderAndFooter, NSPrintJobSavingURL, NSPrintSaveJob};
    use objc2_foundation::{NSNumber, NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    unsafe {
        let view = &*webview.inner().cast::<WKWebView>();
        let info = NSPrintInfo::new();
        info.setJobDisposition(NSPrintSaveJob);
        info.setPaperSize(NSSize::new(595.2, 841.8));
        info.setTopMargin(48.0);
        info.setBottomMargin(48.0);
        info.setLeftMargin(56.0);
        info.setRightMargin(56.0);
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let dictionary = info.dictionary();
        dictionary.setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
        dictionary.setObject_forKey(
            &NSNumber::numberWithBool(false),
            ProtocolObject::from_ref(NSPrintHeaderAndFooter),
        );
        let operation = view.printOperationWithPrintInfo(&info);
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        if !operation.runOperation() {
            return Err("导出 PDF 失败".into());
        }
    }
    if path.is_file() {
        Ok(())
    } else {
        Err("导出 PDF 失败".into())
    }
}
