use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledBrowser {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub supported: bool,
}

struct KnownBrowser {
    id: &'static str,
    name: &'static str,
    supported: bool,
    /// 只在 macOS 上读取；其它平台保留数据，避免拆两套浏览器表。
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    mac_app: &'static str,
    /// 只在 Windows 上读取。
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    win_exes: &'static [&'static str],
}

const KNOWN: &[KnownBrowser] = &[
    KnownBrowser {
        id: "chrome",
        name: "Google Chrome",
        supported: true,
        mac_app: "/Applications/Google Chrome.app",
        win_exes: &[
            r"Google\Chrome\Application\chrome.exe",
            r"Google\Chrome Beta\Application\chrome.exe",
        ],
    },
    KnownBrowser {
        id: "edge",
        name: "Microsoft Edge",
        supported: true,
        mac_app: "/Applications/Microsoft Edge.app",
        win_exes: &[r"Microsoft\Edge\Application\msedge.exe"],
    },
    KnownBrowser {
        id: "brave",
        name: "Brave",
        supported: true,
        mac_app: "/Applications/Brave Browser.app",
        win_exes: &[r"BraveSoftware\Brave-Browser\Application\brave.exe"],
    },
    KnownBrowser {
        id: "arc",
        name: "Arc",
        supported: true,
        mac_app: "/Applications/Arc.app",
        win_exes: &[],
    },
    KnownBrowser {
        id: "firefox",
        name: "Firefox",
        supported: false,
        mac_app: "/Applications/Firefox.app",
        win_exes: &[r"Mozilla Firefox\firefox.exe"],
    },
    KnownBrowser {
        id: "safari",
        name: "Safari",
        supported: false,
        mac_app: "/Applications/Safari.app",
        win_exes: &[],
    },
];

#[cfg(target_os = "windows")]
fn win_exists(relative: &str) -> bool {
    let mut roots = Vec::new();
    if let Ok(pf) = std::env::var("PROGRAMFILES") {
        roots.push(PathBuf::from(pf));
    }
    if let Ok(pf86) = std::env::var("PROGRAMFILES(X86)") {
        roots.push(PathBuf::from(pf86));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        roots.push(PathBuf::from(local));
    }
    roots.iter().any(|root| root.join(relative).is_file())
}

fn is_installed(item: &KnownBrowser) -> bool {
    #[cfg(target_os = "macos")]
    {
        Path::new(item.mac_app).exists()
    }
    #[cfg(target_os = "windows")]
    {
        item.win_exes.iter().any(|exe| win_exists(exe))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = item;
        false
    }
}

#[tauri::command]
pub fn list_installed_browsers() -> Vec<InstalledBrowser> {
    KNOWN
        .iter()
        .filter(|item| is_installed(item))
        .map(|item| InstalledBrowser {
            id: item.id.into(),
            name: item.name.into(),
            installed: true,
            supported: item.supported,
        })
        .collect()
}

fn http_url(url: Option<String>) -> Option<String> {
    let value = url?.trim().to_string();
    if value.starts_with("https://") || value.starts_with("http://") {
        Some(value)
    } else {
        None
    }
}

#[tauri::command]
pub fn open_installed_browser(id: String, url: Option<String>) -> Result<(), String> {
    let item = KNOWN
        .iter()
        .find(|row| row.id == id)
        .ok_or_else(|| "BROWSER_UNKNOWN".to_string())?;
    if !is_installed(item) {
        return Err("BROWSER_MISSING".into());
    }
    let target = http_url(url);
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.args(["-a", item.mac_app]);
        if let Some(page) = target.as_deref() {
            command.arg(page);
        }
        command.status().map_err(|err| err.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let exe = item
            .win_exes
            .iter()
            .map(|rel| {
                let mut roots = Vec::new();
                if let Ok(pf) = std::env::var("PROGRAMFILES") {
                    roots.push(PathBuf::from(pf));
                }
                if let Ok(pf86) = std::env::var("PROGRAMFILES(X86)") {
                    roots.push(PathBuf::from(pf86));
                }
                if let Ok(local) = std::env::var("LOCALAPPDATA") {
                    roots.push(PathBuf::from(local));
                }
                roots.into_iter().map(|root| root.join(rel)).find(|path| path.is_file())
            })
            .find_map(|path| path)
            .ok_or_else(|| "BROWSER_MISSING".to_string())?;
        let mut command = Command::new(exe);
        if let Some(page) = target.as_deref() {
            command.arg(page);
        }
        command.spawn().map_err(|err| err.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = item;
        Err("OPEN_UNSUPPORTED".into())
    }
}

fn extension_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("dist").join("work-extension"));
        candidates.push(resources.join("runtime").join("dist").join("work-extension"));
        candidates.push(resources.join("work-extension"));
    }
    #[cfg(debug_assertions)]
    {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/work-extension"),
        );
    }
    candidates.into_iter().find(|path| path.is_dir())
}

#[tauri::command]
pub fn reveal_work_extension(app: tauri::AppHandle) -> Result<String, String> {
    let dir = extension_dir(&app).ok_or_else(|| "EXTENSION_MISSING".to_string())?;
    let shown = dir.canonicalize().unwrap_or(dir);
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&shown)
            .status()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("explorer")
            .arg(&shown)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|err| err.to_string())?;
    }
    Ok(shown.to_string_lossy().into_owned())
}

/// 截一张当前屏幕，压成较小的 JPEG。只在需要对照画面时调用，不是每个动作都截。
#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    let path = std::env::temp_dir().join(format!("wiki-agent-look-{}.jpg", std::process::id()));
    let path_text = path.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        let shot = Command::new("screencapture")
            .args(["-x", "-t", "jpg", &path_text])
            .output()
            .map_err(|err| err.to_string())?;
        if !shot.status.success() {
            let err = String::from_utf8_lossy(&shot.stderr);
            return Err(if err.trim().is_empty() {
                "SCREEN_CAPTURE_FAILED".into()
            } else {
                err.trim().to_string()
            });
        }
        let _ = Command::new("sips")
            .args(["-Z", "1280", "-s", "format", "jpeg", "-s", "formatOptions", "55", &path_text])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let script = format!(
            "$b=[Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object Drawing.Bitmap $b.Width,$b.Height; $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $bmp.Save('{}',[Drawing.Imaging.ImageFormat]::Jpeg)",
            path_text.replace('\'', "''")
        );
        let shot = Command::new("powershell")
            .args(["-NoProfile", "-Command", &format!("Add-Type -AssemblyName System.Windows.Forms,System.Drawing; {script}")])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|err| err.to_string())?;
        if !shot.status.success() {
            return Err("SCREEN_CAPTURE_FAILED".into());
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path_text;
        return Err("SCREEN_CAPTURE_UNSUPPORTED".into());
    }
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    let _ = std::fs::remove_file(&path);
    if bytes.is_empty() || bytes.len() > 3_500_000 {
        return Err("SCREEN_CAPTURE_FAILED".into());
    }
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}
