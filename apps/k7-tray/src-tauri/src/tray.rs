// tray.rs — the icon and its menu: one status line (two while an instrument downloads), Open k7, and the app's own
// switches. The VIEW: the words come from the backend's status route or from where the backend process stands,
// and every setting of the engine is a page of k7, opened in the browser. See docs/tray.md.

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::state::{Backend, SharedState};
use crate::trayicon::{self, IconState};
use crate::{backend, paths, updates};

pub struct MenuBuild {
    pub menu: Menu<Wry>,
    pub status: MenuItem<Wry>,
    pub downloads: MenuItem<Wry>,
    pub open: MenuItem<Wry>,
    pub autostart: CheckMenuItem<Wry>,
    pub auto_update: CheckMenuItem<Wry>,
}

pub fn build_menu(app: &AppHandle, autostart_on: bool, auto_update_on: bool) -> tauri::Result<MenuBuild> {
    let status = MenuItem::with_id(app, "status", "Starting k7…", false, None::<&str>)?;
    // Built once, inserted under the status line only while an instrument downloads (`refresh`).
    let downloads = MenuItem::with_id(app, "downloads", "", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open k7", false, None::<&str>)?;
    let engine = MenuItem::with_id(app, "engine", "Engine Settings…", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart k7", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Launch at Login", true, autostart_on, None::<&str>)?;
    let check = MenuItem::with_id(app, "check_updates", "Check for Updates…", true, None::<&str>)?;
    let auto_update = CheckMenuItem::with_id(
        app,
        "auto_update",
        "Check for Updates Automatically",
        true,
        auto_update_on,
        None::<&str>,
    )?;
    let logs = MenuItem::with_id(app, "logs", "Show Logs", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit k7 Tray", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let (s1, s2, s3) = (sep()?, sep()?, sep()?);
    let mut items: Vec<&dyn IsMenuItem<Wry>> = vec![&status, &s1, &open, &engine, &restart, &s2, &autostart];
    // Shown only where an update can happen: never in the dev session's debug build, nor in one without a key.
    if updates::available() {
        items.extend([&check as &dyn IsMenuItem<Wry>, &auto_update]);
    }
    items.extend([&logs as &dyn IsMenuItem<Wry>, &s3, &quit]);
    let menu = Menu::with_items(app, &items)?;
    Ok(MenuBuild { menu, status, downloads, open, autostart, auto_update })
}

/// The badge, the status line and the downloads line, from where the backend stands and what it last said.
fn shown(s: &crate::state::AppState) -> (IconState, String, Option<String>) {
    match &s.backend {
        Backend::Starting => (IconState::Loading(s.spinner), "Starting k7…".into(), None),
        Backend::Down(why) => (IconState::Error, format!("⚠ {why}"), None),
        Backend::Ready if s.said.line.is_empty() => {
            (IconState::Loading(s.spinner), "Starting the engine…".into(), None)
        }
        Backend::Ready => {
            let icon = match s.said.icon.as_str() {
                "running" => IconState::Running,
                "loading" => IconState::Loading(s.spinner),
                "error" => IconState::Error,
                _ => IconState::Stopped,
            };
            (icon, s.said.line.clone(), s.said.downloads.clone())
        }
    }
}

/// Advance the spinner and repaint the icon alone: nothing else changes between frames.
pub fn tick_spinner(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (tray, icon) = {
        let mut s = shared.lock().unwrap();
        s.spinner = s.spinner.wrapping_add(1);
        let Some(m) = s.menus.as_ref() else { return };
        (m.tray.clone(), trayicon::render(shown(&s).0))
    };
    let _ = tray.set_icon(Some(icon));
}

/// Repaint everything the menu bar says. The lock is held only to read; Tauri is called with it released.
pub fn refresh(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (status, line, downloads, toggle, open, ready, tray, icon) = {
        let mut s = shared.lock().unwrap();
        let (state, line, downloads) = shown(&s);
        let icon = trayicon::render(state);
        let ready = s.backend == Backend::Ready;
        let Some(m) = s.menus.as_mut() else { return };
        let show = downloads.is_some();
        let toggle = (show != m.downloads_shown).then(|| (m.menu.clone(), show));
        m.downloads_shown = show;
        (m.status.clone(), line, (m.downloads.clone(), downloads), toggle, m.open.clone(), ready, m.tray.clone(), icon)
    };
    let _ = status.set_text(&line);
    let (item, text) = downloads;
    if let Some(text) = text {
        let _ = item.set_text(text);
    }
    if let Some((menu, show)) = toggle {
        let _ = if show { menu.insert(&item, 1) } else { menu.remove(&item) };
    }
    let _ = open.set_enabled(ready);
    let _ = tray.set_icon(Some(icon));
    let _ = tray.set_tooltip(Some(format!("k7 — {line}")));
}

pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => open_path(&backend::url(app, "/")),
        "engine" => open_path(&backend::url(app, "/settings/engine")),
        "restart" => backend::restart(app),
        "autostart" => toggle_autostart(app),
        "check_updates" => updates::check(app, true),
        "auto_update" => {
            let on = !updates::auto_enabled(app);
            updates::set_auto(app, on);
            if let Some(m) = app.state::<SharedState>().lock().unwrap().menus.as_ref() {
                let _ = m.auto_update.set_checked(on);
            }
        }
        "logs" => open_text_file(&paths::merged_log_path()),
        "quit" => app.exit(0),
        _ => {}
    }
}

fn toggle_autostart(app: &AppHandle) {
    let mgr = app.autolaunch();
    let _ = if mgr.is_enabled().unwrap_or(false) { mgr.disable() } else { mgr.enable() };
    if let Some(m) = app.state::<SharedState>().lock().unwrap().menus.as_ref() {
        let _ = m.autostart.set_checked(mgr.is_enabled().unwrap_or(false));
    }
}

/// A folder, a file or an address, in whatever the OS opens it with — the browser, for k7.
pub fn open_path(target: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(target).spawn();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .creation_flags(0x0800_0000)
            .spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(target).spawn();
}

/// A text file: Notepad on Windows, where a `.log` usually has no association.
fn open_text_file(path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("notepad.exe").arg(path).spawn();
    #[cfg(not(target_os = "windows"))]
    open_path(&path.to_string_lossy());
}
