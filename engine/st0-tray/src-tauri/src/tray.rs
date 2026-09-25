// tray.rs — the tray menu, its handlers, and the refresh that keeps labels and icon in step.
// This file is the VIEW: it computes no policy and owns no processes — everything comes down
// in the supervisor's snapshot and every click goes back up as a command. Stop/Restart are
// enabled only for an engine the supervisor OWNS. See docs/tray.md.

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::host;
use crate::state::SharedState;
use crate::trayicon::{self, IconState};

pub struct MenuBuild {
    pub menu: Menu<Wry>,
    pub status: MenuItem<Wry>,
    pub autostart: CheckMenuItem<Wry>,
}

pub fn build_menu(app: &AppHandle, autostart_on: bool) -> tauri::Result<MenuBuild> {
    // The one line of state the menu bar keeps. Everything else about the machine — the version, the
    // registry, the ports, and every button that acts — is a tab of the settings window.
    let status = MenuItem::with_id(app, "status", "○ Stopped", false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    // The way to everything this menu no longer holds — the st0 instances this engine is connected to included.
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Launch at login",
        true,
        autostart_on,
        None::<&str>,
    )?;
    let open_root = MenuItem::with_id(
        app,
        "open_root",
        "Open workspaces root folder",
        true,
        None::<&str>,
    )?;
    let open_log = MenuItem::with_id(app, "open_log", "Show logs", true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit st0-tray"))?;

    let items: Vec<&dyn IsMenuItem<Wry>> = vec![
        &status, &sep1, &settings, &sep2, &autostart, &open_root, &open_log, &sep3, &quit,
    ];
    let menu = Menu::with_items(app, &items)?;

    Ok(MenuBuild {
        menu,
        status,
        autostart,
    })
}

fn short(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

/// Which badge the icon wears. `Running` alone isn't enough: an engine still scanning isn't usable yet,
/// so it gets the spinner.
fn icon_state(s: &crate::state::AppState) -> IconState {
    // No supervisor, no stack: whatever the engine half believes, an unsupervised app must not wear a green dot.
    if s.host_error.is_some() {
        return IconState::Error;
    }
    match s.snapshot.status.as_str() {
        "error" => IconState::Error,
        "running" => match s.snapshot.plugin_count {
            Some(_) => IconState::Running,
            None => IconState::Loading(s.spinner),
        },
        _ => IconState::Stopped,
    }
}

/// Advance the spinner and repaint the ICON: this ticks several times a second, and nothing else
/// can have changed between frames. The scan's own progress is drawn by the settings window.
pub fn tick_spinner(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (tray, icon) = {
        let mut s = shared.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        let tray = m.tray.clone();
        s.spinner = s.spinner.wrapping_add(1);
        (
            tray,
            trayicon::render(icon_state(&s), s.dark_menubar),
        )
    };
    let _ = tray.set_icon(Some(icon));
}

/// Repaint the status line, the icon and the tooltip — all the menu bar still says on its own.
/// Locks the state only to snapshot it (cloning the handles out), then calls Tauri with the lock released.
pub fn refresh(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (status_text, item, tray, icon, tip) = {
        let s = shared.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        let running = s.running();
        let is_error = s.snapshot.status == "error";
        let status_text = if running {
            format!(
                "● Running{} · id {} · :{}",
                if s.owns_running() { "" } else { " (adopted)" },
                short(&s.snapshot.engine_id),
                s.snapshot.engine_port
            )
        } else if is_error {
            format!("⚠ {}", s.snapshot.error.as_deref().unwrap_or("error"))
        } else {
            "○ Stopped".to_string()
        };
        // A missing supervisor REPLACES the status line rather than decorating it: with nothing supervising, what the
        // engine half believes is not what the user needs to read.
        let status_text = match &s.host_error {
            Some(e) => format!("⚠ {e}"),
            None => status_text,
        };
        let tip = if running {
            "st0-engine — running"
        } else if is_error {
            "st0-engine — error"
        } else {
            "st0-engine — stopped"
        };
        (
            status_text,
            m.status.clone(),
            m.tray.clone(),
            trayicon::render(icon_state(&s), s.dark_menubar),
            tip,
        )
    };
    let _ = item.set_text(status_text);
    let _ = tray.set_icon(Some(icon));
    let _ = tray.set_tooltip(Some(tip));
}

/// Handle a tray menu click. `quit` is a predefined item and is not routed here.
pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "settings" => crate::settingswin::open(app),
        "autostart" => toggle_autostart(app),
        "open_root" => open_root(app),
        "open_log" => {
            let p = app.state::<SharedState>().lock().unwrap().snapshot.paths.merged_log.clone();
            open_text_file(std::path::Path::new(&p));
        }
        _ => {}
    }
}

/// A passive OS notification — banner on macOS, toast on Windows, libnotify on Linux — for anything the app
/// raises on its OWN: a blocked web UI can be refused dozens of times a second while a browser retries, and a
/// modal per refusal would make the machine unusable. This one stacks quietly and can be ignored.
pub fn notify_passive(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    // Report the failure rather than swallow it: a notification that never arrives is indistinguishable from
    // "nothing was blocked", which is the exact wrong conclusion to draw.
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[notify] could not post a notification: {e}");
    }
}

/// A MODAL dialog the user must dismiss. Right for "you clicked a thing and it failed", wrong for anything
/// the app raises on its own — see notify_passive.
pub fn notify_modal(title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display dialog {} with title \"st0-tray\" buttons {{\"OK\"}} default button \"OK\" with icon caution",
            applescript_string(&format!("{title}\n\n{body}"))
        );
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .spawn();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (title, body);
    }
}

/// Quote a Rust string as an AppleScript literal.
#[cfg(target_os = "macos")]
fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Send the WHOLE ranking, joined by U+001F to match hostProtocol.ts's PRIORITY_SEP. One command and
/// not one per rank: a reorder is a single act, and two halves of it could interleave with a poll.
pub fn send_audio_priority(app: &AppHandle, ranked: &[String]) {
    host::send(app, "audio.priority", Some(&ranked.join("\u{1f}")));
}



// Every one of these used to spawn, kill and watch processes here; they are single lines on the pipe now.
// The supervisor owns the engine and file service, so the tray can't get out of step with it — and a click
// never blocks the menu thread on a kill, a port probe or an HTTP round-trip.







fn toggle_autostart(app: &AppHandle) {
    let mgr = app.autolaunch();
    let now_on = mgr.is_enabled().unwrap_or(false);
    let _ = if now_on {
        mgr.disable()
    } else {
        mgr.enable()
    };
    if let Some(m) = app.state::<SharedState>().lock().unwrap().menus.as_ref() {
        let _ = m.autostart.set_checked(mgr.is_enabled().unwrap_or(false));
    }
}

// Open the workspaces root, creating it first so there is always a folder to open. The path is the supervisor's.
fn open_root(app: &AppHandle) {
    let dir = app.state::<SharedState>().lock().unwrap().snapshot.paths.root.clone();
    if dir.is_empty() {
        return; // no snapshot yet; nothing to open and nothing worth creating
    }
    let _ = std::fs::create_dir_all(&dir);
    open_path(std::path::Path::new(&dir));
}

/// Apply a fresh snapshot and repaint. It REPLACES what was there — a whole picture every time — so a
/// supervisor that crashed and relaunched resyncs us in one message with nothing to replay. The window is
/// redrawn only when what it displays actually moved, since this runs on every reported change.
pub fn apply_snapshot(app: &AppHandle, snapshot: crate::host::Snapshot) {
    let settings_changed = {
        let shared = app.state::<SharedState>();
        let mut s = shared.lock().unwrap();
        // Gated on the SUPERVISOR's signatures, not on comparing arrays: redrawing a list the user may be reading,
        // because a heartbeat flipped, is visible churn. Field by field, and only the fields the WINDOW draws — see
        // settingswin::differs.
        let settings_changed = crate::settingswin::differs(&s.snapshot, &snapshot);
        s.snapshot = snapshot;
        // A snapshot arriving IS the supervisor working, so whatever we last complained about is over.
        s.host_error = None;
        settings_changed
    };
    if settings_changed {
        crate::settingswin::push(app);
    }
    // The icon and the status line are drawn from the snapshot, so repainting them is all it takes.
    refresh(app);
}

/// Report that the supervisor is missing or restarting (None clears it) — this outranks every other status.
pub fn set_host_error(app: &AppHandle, error: Option<String>) {
    {
        let shared = app.state::<SharedState>();
        shared.lock().unwrap().host_error = error;
    }
    refresh(app);
    // The System tab leads with this too: a missing supervisor replaces the engine's own story.
    crate::settingswin::push(app);
}

fn open_path(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", &path.to_string_lossy()])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
}

/// Open a text file for the user. On Windows we name Notepad explicitly: a `.log` usually has no association,
/// so `start` would fail or open whatever claimed the extension, while Notepad always shows the text.
fn open_text_file(path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("notepad.exe").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
}
