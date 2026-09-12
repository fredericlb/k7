// tray.rs — the tray menu, its handlers, and the refresh that keeps labels and icon in step.
// This file is the VIEW: it computes no policy and owns no processes — everything comes down
// in the supervisor's snapshot and every click goes back up as a command. Stop/Restart are
// enabled only for an engine the supervisor OWNS. See docs/tray.md.

use tauri::menu::{
    CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::host;
use crate::state::SharedState;
use crate::trayicon::{self, IconState};

pub struct MenuBuild {
    pub menu: Menu<Wry>,
    pub status: MenuItem<Wry>,
    pub weburi: Submenu<Wry>,
    pub autostart: CheckMenuItem<Wry>,
}

pub fn build_menu(app: &AppHandle, autostart_on: bool) -> tauri::Result<MenuBuild> {
    // The one line of state the menu bar keeps. Everything else about the machine — the version, the
    // registry, the ports, and every button that acts — is a tab of the settings window.
    let status = MenuItem::with_id(app, "status", "○ Stopped", false, None::<&str>)?;
    // The web UIs allowed to reach this engine. Always enabled: it holds "Add…" even when empty, which is when
    // you need it most.
    let weburi = Submenu::with_id(app, "weburi", "Web UI", true)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    // The way to everything this menu no longer holds.
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
        &status, &weburi, &sep1, &settings, &sep2, &autostart, &open_root, &open_log, &sep3,
        &quit,
    ];
    let menu = Menu::with_items(app, &items)?;

    Ok(MenuBuild {
        menu,
        status,
        weburi,
        autostart,
    })
}

/// Rebuild the "Web UI" submenu: one row per allowed origin (clicking removes it), then "Add web UI…".
/// CLEARED wholesale rather than tracked, because the separator isn't a MenuItem and so couldn't be removed
/// from a typed Vec — it would accumulate one copy per rebuild.
pub fn rebuild_weburi_menu(app: &AppHandle) {
    // Both lists come from the supervisor, which owns web-origins.json and the refusals — the tray parses neither
    // any more, which is what stopped the two sides disagreeing about what a valid origin is.
    let (submenu, origins, pending) = {
        let s = app.state::<SharedState>();
        let s = s.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        (
            m.weburi.clone(),
            s.snapshot.web_origins.clone(),
            s.snapshot.web_pending.clone(),
        )
    };
    // Drain from the front: remove_at hands the item back, so repeating at 0 empties the submenu whatever the
    // children are — a separator included, which a typed Vec could not express.
    while matches!(submenu.remove_at(0), Ok(Some(_))) {}

    if origins.is_empty() {
        // Say why the list is empty rather than showing a bare "Add…" with no context.
        if let Ok(item) =
            MenuItem::with_id(app, "weburi_none", "No web UI added", false, None::<&str>)
        {
            let _ = submenu.append(&item);
        }
    }
    for o in &origins {
        // The label carries the removal affordance: a tray menu has no context menu and no delete key.
        if let Ok(item) = MenuItem::with_id(
            app,
            format!("weburi_del:{o}"),
            format!("{o}   ✕"),
            true,
            None::<&str>,
        ) {
            let _ = submenu.append(&item);
        }
    }
    // Origins the file service just refused — how a web UI gets added on Windows and Linux, where there is no
    // native prompt: the blocked browser names itself instead of the user typing a URL. The icon's attention dot
    // tracks this same list from the same snapshot, so allowing or ignoring one clears it for free.
    if !pending.is_empty() {
        if let Ok(sep) = PredefinedMenuItem::separator(app) {
            let _ = submenu.append(&sep);
        }
        if let Ok(head) = MenuItem::with_id(
            app,
            "weburi_pending_head",
            "Blocked just now — allow?",
            false,
            None::<&str>,
        ) {
            let _ = submenu.append(&head);
        }
        for o in &pending {
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("weburi_allow:{o}"),
                format!("✓ {o}"),
                true,
                None::<&str>,
            ) {
                let _ = submenu.append(&item);
            }
            // Dismissing matters: a refused origin you do NOT trust would sit there, training you to ignore the section.
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("weburi_deny:{o}"),
                "        ignore".to_string(),
                true,
                None::<&str>,
            ) {
                let _ = submenu.append(&item);
            }
        }
    }

    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        let _ = submenu.append(&sep);
    }
    if let Ok(item) = MenuItem::with_id(app, "weburi_add", "Add web UI…", true, None::<&str>) {
        let _ = submenu.append(&item);
    }
    // Repaint: the attention dot above only reaches the menu bar through refresh().
    refresh(app);
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
    // A dead file service turns the badge RED even with the engine fine — the web UI can't reach any files, so
    // "running" would be a lie. "Restart file service" is the paired fix.
    if s.snapshot.file_service_failed {
        return IconState::Stopped;
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
            trayicon::render_with(icon_state(&s), s.dark_menubar, s.snapshot.attention),
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
        // A dead file service shows on the status line too, not just the icon — this line is where "red" is explained.
        let file_failed = s.snapshot.file_service_failed;
        let status_text = if file_failed && s.host_error.is_none() {
            format!("{status_text} · ⚠ file service down")
        } else {
            status_text
        };
        let tip = if file_failed {
            "st0-engine — file service stopped"
        } else if running {
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
            trayicon::render_with(icon_state(&s), s.dark_menubar, s.snapshot.attention),
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
        "weburi_add" => add_web_ui(app),
        // The three weburi rows are pure command sends; the menu redraws on the next snapshot, not on the click.
        _ if id.starts_with("weburi_allow:") => {
            host::send(app, "weburi.allow", Some(&id["weburi_allow:".len()..]));
        }
        _ if id.starts_with("weburi_deny:") => {
            host::send(app, "weburi.deny", Some(&id["weburi_deny:".len()..]));
        }
        _ if id.starts_with("weburi_del:") => {
            host::send(app, "weburi.remove", Some(&id["weburi_del:".len()..]));
        }
        _ => {}
    }
}

/// Ask for a web UI URL and hand it to the supervisor. The prompt is view work, so it stays here; everything
/// that FOLLOWS is the supervisor's. `weburi.add` has two effects there, a st0 web UI being single-origin:
/// the origin joins the allowlist, and it becomes this engine's registry URL so it shows in that UI's picker.
fn add_web_ui(app: &AppHandle) {
    let Some(input) = prompt_for_origin() else {
        // Cancelled — or a platform with no native prompt, where opening the file by hand is the honest fallback.
        #[cfg(not(target_os = "macos"))]
        {
            let path = app
                .state::<SharedState>()
                .lock()
                .unwrap()
                .snapshot
                .paths
                .web_origins
                .clone();
            if !path.is_empty() {
                let p = std::path::Path::new(&path);
                if let Some(dir) = p.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                if !p.exists() {
                    let _ = std::fs::write(p, "{\n  \"origins\": []\n}\n");
                }
                open_path(p);
            }
        }
        return;
    };
    host::send(app, "weburi.add", Some(&input));
}

/// Ask for a web UI URL with a native dialog. macOS only: elsewhere `add_web_ui` opens the origins file, and
/// the "allow?" rows are the real path anyway — a blocked browser names itself, so nobody types a URL.
#[cfg(target_os = "macos")]
fn prompt_for_origin() -> Option<String> {
    use std::process::Command;
    // `with icon note` keeps it a normal dialog rather than an alarming alert, seeded with the scheme.
    let script = r#"try
    set r to display dialog "Add a st0 web UI. Its address is allowed to reach this engine." with title "st0-tray" default answer "https://" with icon note buttons {"Cancel", "Add"} default button "Add"
    return text returned of r
on error number -128
    return ""
end try"#;
    let out = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Cancel yields an empty line; so does clearing the field. Both mean "no".
    if text.is_empty() || text == "https://" {
        None
    } else {
        Some(text)
    }
}

#[cfg(not(target_os = "macos"))]
fn prompt_for_origin() -> Option<String> {
    None
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
/// supervisor that crashed and relaunched resyncs us in one message with nothing to replay. Submenus are
/// rebuilt only when what they display actually moved, since this runs on every reported change.
pub fn apply_snapshot(app: &AppHandle, snapshot: crate::host::Snapshot) {
    let (weburi_changed, settings_changed) = {
        let shared = app.state::<SharedState>();
        let mut s = shared.lock().unwrap();
        let weburi_changed = s.snapshot.web_origins != snapshot.web_origins
            || s.snapshot.web_pending != snapshot.web_pending;
        // The rebuilt submenus are gated on the SUPERVISOR's signatures, not on comparing arrays: tearing down and
        // re-adding every row of a submenu the user may have open, because a heartbeat flipped, is visible churn.
        // Field by field, and only the fields the WINDOW draws — see settingswin::differs.
        let settings_changed = crate::settingswin::differs(&s.snapshot, &snapshot);
        s.snapshot = snapshot;
        // A snapshot arriving IS the supervisor working, so whatever we last complained about is over.
        s.host_error = None;
        (weburi_changed, settings_changed)
    };
    if settings_changed {
        crate::settingswin::push(app);
    }
    if weburi_changed {
        rebuild_weburi_menu(app); // ends in refresh()
    } else {
        refresh(app);
    }
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
