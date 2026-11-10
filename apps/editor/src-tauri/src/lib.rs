use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

mod export_cmd;

use tauri::Manager;

struct DesktopServer(Mutex<Option<Child>>);

#[cfg(target_os = "windows")]
const NODE_NAME: &str = "wiki-agent-service.exe";
#[cfg(not(target_os = "windows"))]
const NODE_NAME: &str = "node";

/// Windows 下 GUI 进程拉起控制台程序会弹黑框
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
}

/// Windows 扩展路径前缀 `\\?\` 传给 Node 会把入口脚本解析坏（报 EISDIR lstat 'D:'）。
/// 启动子进程前剥掉，改回普通盘符/UNC 路径。
fn for_child_path(path: &std::path::Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let raw = path.to_string_lossy();
        if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
        return path.to_path_buf();
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_path_buf()
    }
}

fn append_log(message: &str) {
    let Some(dir) = exe_dir() else {
        eprintln!("{message}");
        return;
    };
    let path = dir.join("wiki-agent-desktop.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{message}");
    }
    eprintln!("{message}");
}

fn show_startup_error(title: &str, message: &str) {
    append_log(&format!("ERROR {title}: {message}"));
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title(title)
            .set_description(message)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
}

fn candidate_paths(app: &tauri::App, name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("runtime").join(name));
        candidates.push(resources.join(name));
        // NSIS 偶发把资源摊到 resources 根或 _up_ 旁
        candidates.push(resources.join("resources").join("runtime").join(name));
    }
    if let Some(dir) = exe_dir() {
        candidates.push(dir.join("runtime").join(name));
        candidates.push(dir.join(name));
        candidates.push(dir.join("resources").join("runtime").join(name));
        candidates.push(dir.join("resources").join(name));
    }
    candidates
}

fn bundled_path(app: &tauri::App, name: &str) -> Option<PathBuf> {
    candidate_paths(app, name)
        .into_iter()
        .find(|path| path.exists())
}

fn bundled_node(app: &tauri::App) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        for name in [NODE_NAME, "node.exe"] {
            if let Some(path) = bundled_path(app, name) {
                if path.is_file() {
                    return Some(path);
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        bundled_path(app, NODE_NAME).filter(|path| path.is_file())
    }
}

fn missing_resource_hint(app: &tauri::App, name: &str) -> String {
    let tried = candidate_paths(app, name)
        .into_iter()
        .map(|path| format!("  - {}", path.display()))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "找不到「{name}」。\n\n\
便携 zip 请整包解压后再双击 exe，不要只拷贝单个文件。目录应类似：\n\
  wiki-agent-windows/\n\
    wiki-agent.exe\n\
    runtime/\n\
      wiki-agent-service.exe\n\
      desktop-server.mjs\n\
      dist/\n\n\
已查找：\n{tried}\n\n\
若文件都在，请检查杀软是否隔离了 wiki-agent-service.exe。\n\
详情见同目录 wiki-agent-desktop.log"
    )
}

fn tail_log(path: &PathBuf, max_chars: usize) -> String {
    match std::fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => {
            let trimmed = text.trim();
            if trimmed.len() <= max_chars {
                trimmed.to_string()
            } else {
                trimmed[trimmed.len() - max_chars..].to_string()
            }
        }
        _ => String::new(),
    }
}

fn read_port_marker(path: &PathBuf) -> Option<u16> {
    let text = std::fs::read_to_string(path).ok()?;
    text.trim().parse::<u16>().ok()
}

fn start_desktop_server(app: &tauri::App) -> Result<u16, String> {
    let node_raw = bundled_node(app).ok_or_else(|| missing_resource_hint(app, NODE_NAME))?;
    let script_raw = bundled_path(app, "desktop-server.mjs")
        .ok_or_else(|| missing_resource_hint(app, "desktop-server.mjs"))?;
    let dist_raw = bundled_path(app, "dist").ok_or_else(|| missing_resource_hint(app, "dist"))?;
    if !node_raw.is_file() || !script_raw.is_file() || !dist_raw.is_dir() {
        return Err(missing_resource_hint(app, "runtime 资源"));
    }

    let node = for_child_path(&node_raw);
    let script = for_child_path(&script_raw);
    let dist = for_child_path(&dist_raw);
    let runtime_dir = script
        .parent()
        .map(|dir| dir.to_path_buf())
        .unwrap_or_else(|| dist.parent().unwrap_or(dist.as_path()).to_path_buf());
    let port_marker = runtime_dir.join(".desktop-port");
    let _ = std::fs::remove_file(&port_marker);

    append_log(&format!(
        "starting service node={} script={} dist={} cwd={}",
        node.display(),
        script.display(),
        dist.display(),
        runtime_dir.display()
    ));

    let log_path = exe_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("wiki-agent-service.log");
    let stderr_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|err| format!("无法写入日志 {}: {err}", log_path.display()))?;

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg(&dist)
        .current_dir(&runtime_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr_file));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|err| {
        format!(
            "无法启动本机服务（{err}）。\n\
请确认 runtime 里的服务程序未被杀软隔离，并允许其联网。\n\
日志：{}",
            log_path.display()
        )
    })?;
    let stdout = child.stdout.take().ok_or("无法读取本机服务输出")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut lines = BufReader::new(stdout).lines();
        while let Some(Ok(line)) = lines.next() {
            let trimmed = line.trim_start_matches('\u{feff}').trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("PORT ") {
                if let Ok(port) = rest.trim().parse::<u16>() {
                    let _ = tx.send(port);
                    break;
                }
            }
        }
        for _ in lines {}
    });

    // 同时轮询端口标记文件，避免 Windows 管道缓冲导致永远读不到 stdout
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    let port = loop {
        if let Some(port) = read_port_marker(&port_marker) {
            break port;
        }
        if std::time::Instant::now() >= deadline {
            let status = child.try_wait().ok().flatten();
            let _ = child.kill();
            let log_tail = tail_log(&log_path, 600);
            let log_hint = if log_tail.is_empty() {
                String::new()
            } else {
                format!("\n\n服务日志末尾：\n{log_tail}")
            };
            return Err(format!(
                "本机服务没有在限定时间内就绪。\n\
常见原因：zip 未整包解压、杀软隔离 runtime 服务、或本机服务启动失败。\n\
子进程状态：{status:?}\n\
请查看：\n  {}\n  {}{log_hint}",
                log_path.display(),
                exe_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("wiki-agent-desktop.log")
                    .display()
            ));
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(port) => break port,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    };
    let _ = std::fs::remove_file(&port_marker);
    app.manage(DesktopServer(Mutex::new(Some(child))));
    append_log(&format!("desktop server ready on 127.0.0.1:{port}"));
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

fn open_local_app(window: &tauri::WebviewWindow, port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/app")
        .parse::<tauri::Url>()
        .map_err(|err| err.to_string())?;
    window.navigate(url).map_err(|err| err.to_string())
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            export_cmd::pick_save_path,
            export_cmd::write_export_file,
            export_cmd::export_pdf,
        ])
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            let Some(window) = app.get_webview_window("main") else {
                return Ok(());
            };
            #[cfg(not(debug_assertions))]
            {
                match start_desktop_server(app) {
                    Ok(port) => {
                        if let Err(err) = open_local_app(&window, port) {
                            show_startup_error(
                                "wiki-agent 无法打开页面",
                                &format!("{err}\n\n本机服务已启动（端口 {port}），但窗口跳转失败。"),
                            );
                            app.handle().exit(1);
                            return Ok(());
                        }
                    }
                    Err(err) => {
                        show_startup_error("wiki-agent 无法联网启动", &err);
                        // 不要展示没有代理的空白壳，避免「能开但不能联网」的假象
                        app.handle().exit(1);
                        return Ok(());
                    }
                }
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
