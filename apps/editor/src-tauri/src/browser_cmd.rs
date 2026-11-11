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
    mac_app: &'static str,
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

#[tauri::command]
pub fn open_installed_browser(id: String) -> Result<(), String> {
    let item = KNOWN
        .iter()
        .find(|row| row.id == id)
        .ok_or_else(|| "BROWSER_UNKNOWN".to_string())?;
    if !is_installed(item) {
        return Err("BROWSER_MISSING".into());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", item.mac_app])
            .status()
            .map_err(|err| err.to_string())?;
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
        Command::new(exe).spawn().map_err(|err| err.to_string())?;
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
