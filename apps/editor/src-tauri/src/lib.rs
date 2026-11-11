use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

mod browser_cmd;
mod export_cmd;

use serde::Deserialize;
use tauri::Manager;

const CHECK_UPDATE_MENU_ID: &str = "check-update";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeMenuLabels {
    check_update: String,
    about: String,
    services: String,
    hide: String,
    hide_others: String,
    show_all: String,
    quit: String,
    file: String,
    close_window: String,
    edit: String,
    undo: String,
    redo: String,
    cut: String,
    copy: String,
    paste: String,
    select_all: String,
    view: String,
    fullscreen: String,
    window: String,
    minimize: String,
    zoom: String,
    help: String,
}

impl NativeMenuLabels {
    fn zh() -> Self {
        Self {
            check_update: "检查更新".into(),
            about: "关于 wiki-agent".into(),
            services: "服务".into(),
            hide: "隐藏 wiki-agent".into(),
            hide_others: "隐藏其他".into(),
            show_all: "全部显示".into(),
            quit: "退出 wiki-agent".into(),
            file: "文件".into(),
            close_window: "关闭窗口".into(),
            edit: "编辑".into(),
            undo: "撤销".into(),
            redo: "重做".into(),
            cut: "剪切".into(),
            copy: "复制".into(),
            paste: "粘贴".into(),
            select_all: "全选".into(),
            view: "显示".into(),
            fullscreen: "进入全屏".into(),
            window: "窗口".into(),
            minimize: "最小化".into(),
            zoom: "缩放".into(),
            help: "帮助".into(),
        }
    }

    fn en() -> Self {
        Self {
            check_update: "Check for updates".into(),
            about: "About wiki-agent".into(),
            services: "Services".into(),
            hide: "Hide wiki-agent".into(),
            hide_others: "Hide Others".into(),
            show_all: "Show All".into(),
            quit: "Quit wiki-agent".into(),
            file: "File".into(),
            close_window: "Close Window".into(),
            edit: "Edit".into(),
            undo: "Undo".into(),
            redo: "Redo".into(),
            cut: "Cut".into(),
            copy: "Copy".into(),
            paste: "Paste".into(),
            select_all: "Select All".into(),
            view: "View".into(),
            fullscreen: "Enter Full Screen".into(),
            window: "Window".into(),
            minimize: "Minimize".into(),
            zoom: "Zoom".into(),
            help: "Help".into(),
        }
    }

    fn from_system() -> Self {
        let lang = std::env::var("LANG")
            .or_else(|_| std::env::var("LC_ALL"))
            .unwrap_or_default()
            .to_lowercase();
        if lang.starts_with("zh") {
            Self::zh()
        } else {
            Self::en()
        }
    }
}

/// 用当前界面语言重建系统菜单（含检查更新），避免菜单栏一直是英文默认项。
#[cfg(target_os = "macos")]
fn apply_native_menu(app: &tauri::AppHandle, labels: &NativeMenuLabels) -> Result<(), String> {
    use tauri::menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
    };

    let pkg = app.package_info();
    let about_meta = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app.config().bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let check = MenuItem::with_id(app, CHECK_UPDATE_MENU_ID, &labels.check_update, true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let app_menu = Submenu::with_items(
        app,
        pkg.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, Some(labels.about.as_str()), Some(about_meta)).map_err(|err| err.to_string())?,
            &check,
            &PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::services(app, Some(labels.services.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::hide(app, Some(labels.hide.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::hide_others(app, Some(labels.hide_others.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::show_all(app, Some(labels.show_all.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::quit(app, Some(labels.quit.as_str())).map_err(|err| err.to_string())?,
        ],
    )
    .map_err(|err| err.to_string())?;
    let file_menu = Submenu::with_items(
        app,
        &labels.file,
        true,
        &[&PredefinedMenuItem::close_window(app, Some(labels.close_window.as_str())).map_err(|err| err.to_string())?],
    )
    .map_err(|err| err.to_string())?;
    let edit_menu = Submenu::with_items(
        app,
        &labels.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(labels.undo.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::redo(app, Some(labels.redo.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::cut(app, Some(labels.cut.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::copy(app, Some(labels.copy.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::paste(app, Some(labels.paste.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::select_all(app, Some(labels.select_all.as_str())).map_err(|err| err.to_string())?,
        ],
    )
    .map_err(|err| err.to_string())?;
    let view_menu = Submenu::with_items(
        app,
        &labels.view,
        true,
        &[&PredefinedMenuItem::fullscreen(app, Some(labels.fullscreen.as_str())).map_err(|err| err.to_string())?],
    )
    .map_err(|err| err.to_string())?;
    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        &labels.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(labels.minimize.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::maximize(app, Some(labels.zoom.as_str())).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?,
            &PredefinedMenuItem::close_window(app, Some(labels.close_window.as_str())).map_err(|err| err.to_string())?,
        ],
    )
    .map_err(|err| err.to_string())?;
    let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, &labels.help, true, &[])
        .map_err(|err| err.to_string())?;
    let menu = Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
    )
    .map_err(|err| err.to_string())?;
    app.set_menu(menu).map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_native_menu(app: &tauri::App) {
    use tauri::Emitter;

    let _ = apply_native_menu(app.handle(), &NativeMenuLabels::from_system());
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == CHECK_UPDATE_MENU_ID {
            let _ = app.emit("app-update-check", ());
        }
    });
}

const AI_COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const AI_OUTPUT_LIMIT: usize = 16 * 1024;
const AI_FILE_LIMIT: u64 = 256 * 1024;

fn clip_output(text: String) -> String {
    if text.len() <= AI_OUTPUT_LIMIT {
        return text;
    }
    let mut end = AI_OUTPUT_LIMIT;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…(truncated)", &text[..end])
}

fn wait_child(mut child: Child) -> Result<String, String> {
    let deadline = Instant::now() + AI_COMMAND_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_string(&mut stdout);
                }
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                let mut out = String::new();
                if !stdout.trim().is_empty() {
                    out.push_str(&stdout);
                }
                if !stderr.trim().is_empty() {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(&stderr);
                }
                if !status.success() {
                    let code = status.code().map(|n| n.to_string()).unwrap_or_else(|| "?".into());
                    if out.is_empty() {
                        return Err(format!("exit {code}"));
                    }
                    return Ok(clip_output(format!("exit {code}\n{out}")));
                }
                return Ok(clip_output(if out.is_empty() { "(no output)".into() } else { out }));
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                return Err("COMMAND_TIMEOUT".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(80)),
            Err(err) => return Err(err.to_string()),
        }
    }
}

/// 用户在聊天里点了允许之后，才执行这一条本机命令。
#[tauri::command]
fn run_ai_command(command: String) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() || command.len() > 4000 || command.contains('\0') {
        return Err("COMMAND_INVALID".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let child = Command::new("cmd")
            .args(["/C", command])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| err.to_string())?;
        wait_child(child)
    }
    #[cfg(not(windows))]
    {
        let child = Command::new("sh")
            .args(["-c", command])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| err.to_string())?;
        wait_child(child)
    }
}

#[tauri::command]
fn open_ai_target(target: String) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() || target.len() > 4000 || target.contains('\0') {
        return Err("TARGET_INVALID".into());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|err| err.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        Command::new("cmd")
            .args(["/C", "start", "", target])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|err| err.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = target;
        Err("OPEN_UNSUPPORTED".into())
    }
}

#[tauri::command]
fn read_ai_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("PATH_INVALID".into());
    }
    let meta = std::fs::metadata(&path).map_err(|err| err.to_string())?;
    if !meta.is_file() {
        return Err("NOT_A_FILE".into());
    }
    if meta.len() > AI_FILE_LIMIT {
        return Err("FILE_TOO_LARGE".into());
    }
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    Ok(clip_output(String::from_utf8_lossy(&bytes).into_owned()))
}

#[tauri::command]
fn set_native_menu_locale(app: tauri::AppHandle, labels: NativeMenuLabels) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        apply_native_menu(&app, &labels)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, labels);
        Ok(())
    }
}

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

/// 可写目录：macOS 从 dmg / Downloads 直接打开会走 App Translocation，
/// `.app` 在只读临时路径里，不能把日志写到 exe 旁边。
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

fn dir_is_writable(dir: &Path) -> bool {
    let probe = dir.join(".wiki-agent-write-test");
    match OpenOptions::new().create(true).write(true).truncate(true).open(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn resolve_data_dir(app: &tauri::App) -> PathBuf {
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if dir_is_writable(&dir) {
            return dir;
        }
    }
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if dir_is_writable(&dir) {
            return dir;
        }
    }
    let tmp = std::env::temp_dir().join("wiki-agent");
    let _ = std::fs::create_dir_all(&tmp);
    tmp
}

fn data_dir(app: &tauri::App) -> PathBuf {
    DATA_DIR.get_or_init(|| resolve_data_dir(app)).clone()
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
    let dir = DATA_DIR.get().cloned().or_else(exe_dir);
    if let Some(dir) = dir {
        let path = dir.join("wiki-agent-desktop.log");
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{message}");
        }
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
详情见日志目录里的 wiki-agent-desktop.log"
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
    let data_dir = data_dir(app);
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
    let port_marker = data_dir.join(".desktop-port");
    let _ = std::fs::remove_file(&port_marker);

    append_log(&format!(
        "starting service node={} script={} dist={} cwd={} data={}",
        node.display(),
        script.display(),
        dist.display(),
        runtime_dir.display(),
        data_dir.display()
    ));

    let log_path = data_dir.join("wiki-agent-service.log");
    let stderr_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|err| format!("无法写入日志 {}: {err}", log_path.display()))?;

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg(&dist)
        .current_dir(&runtime_dir)
        .env("EDITOR_DATA_DIR", &data_dir)
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
                data_dir.join("wiki-agent-desktop.log").display()
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
            set_native_menu_locale,
            run_ai_command,
            open_ai_target,
            read_ai_file,
            browser_cmd::list_installed_browsers,
            browser_cmd::open_installed_browser,
            browser_cmd::reveal_work_extension,
            browser_cmd::capture_screen,
        ])
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            #[cfg(target_os = "macos")]
            install_native_menu(app);
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
