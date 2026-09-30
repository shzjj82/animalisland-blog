use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use tauri::Manager;

struct DesktopServer(Mutex<Option<Child>>);

#[cfg(target_os = "windows")]
const NODE_NAME: &str = "wiki-agent-service.exe";
#[cfg(not(target_os = "windows"))]
const NODE_NAME: &str = "node";

/// Windows 下 GUI 进程拉起控制台程序会弹黑框
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn bundled_path(app: &tauri::App, name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("runtime").join(name));
        candidates.push(resources.join(name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("runtime").join(name));
            candidates.push(dir.join(name));
            candidates.push(dir.join("resources").join(name));
        }
    }
    candidates.into_iter().find(|path| path.exists())
}

fn start_desktop_server(app: &tauri::App) -> Result<u16, String> {
    let node = bundled_path(app, NODE_NAME).ok_or_else(|| "缺少本机 Node".to_string())?;
    let script = bundled_path(app, "desktop-server.mjs").ok_or_else(|| "缺少写作服务".to_string())?;
    let dist = bundled_path(app, "dist").ok_or_else(|| "缺少页面目录".to_string())?;
    if !node.is_file() || !script.is_file() || !dist.is_dir() {
        return Err("桌面资源不完整".to_string());
    }

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg(&dist)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|err| err.to_string())?;
    let stdout = child.stdout.take().ok_or("无法读取本机服务输出")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut lines = BufReader::new(stdout).lines();
        if let Some(Ok(line)) = lines.next() {
            if let Some(rest) = line.strip_prefix("PORT ") {
                if let Ok(port) = rest.trim().parse::<u16>() {
                    let _ = tx.send(port);
                }
            }
        }
        for _ in lines {}
    });
    let port = rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "本机服务没有在限定时间内启动".to_string())?;
    app.manage(DesktopServer(Mutex::new(Some(child))));
    Ok(port)
}

fn stop_desktop_server(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<DesktopServer>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
}

#[cfg(not(debug_assertions))]
const WEBVIEW_GUARD: &str = include_str!("guard.js");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(not(debug_assertions))]
    let builder = builder.on_page_load(|webview, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            let _ = webview.eval(WEBVIEW_GUARD);
        }
    });
    builder
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            let Some(window) = app.get_webview_window("main") else {
                return Ok(());
            };
            #[cfg(not(debug_assertions))]
            match start_desktop_server(app) {
                Ok(port) => match format!("http://127.0.0.1:{port}/").parse::<tauri::Url>() {
                    Ok(url) => {
                        if let Err(err) = window.navigate(url) {
                            eprintln!("{err}");
                        }
                    }
                    Err(err) => eprintln!("{err}"),
                },
                Err(err) => eprintln!("{err}"),
            }
            let _ = window.show();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("编辑器窗口没有起来")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                stop_desktop_server(app);
            }
        });
}
