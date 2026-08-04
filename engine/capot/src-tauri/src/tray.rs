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
    pub registry: MenuItem<Wry>,
    pub plugins: MenuItem<Wry>,
    pub rescan: MenuItem<Wry>,
    pub sessions: Submenu<Wry>,
    pub edit_plugins: Submenu<Wry>,
    pub audio: Submenu<Wry>,
    pub weburi: Submenu<Wry>,
    pub start: MenuItem<Wry>,
    pub stop: MenuItem<Wry>,
    pub restart: MenuItem<Wry>,
    pub restart_file: MenuItem<Wry>,
    pub clear_waveform_cache: MenuItem<Wry>,
    pub autostart: CheckMenuItem<Wry>,
}

pub fn build_menu(app: &AppHandle, autostart_on: bool) -> tauri::Result<MenuBuild> {
    let status = MenuItem::with_id(app, "status", "○ Stopped", false, None::<&str>)?;
    let registry = MenuItem::with_id(app, "registry", "registry —", false, None::<&str>)?;
    let plugins = MenuItem::with_id(app, "plugins", "Plugins: —", false, None::<&str>)?;
    // Trigger a full plugin rescan; enabled only with the engine running. Clears the count, so the spinner shows.
    let rescan = MenuItem::with_id(app, "rescan", "Rescan plugins", false, None::<&str>)?;
    // The loaded project's external plugin instances; a row opens the plugin's own nativePluginUI window, which is
    // not the module's moduleUI (the widget grid built in the web editor, never seen here).
    let edit_plugins = Submenu::with_id(app, "edit_plugins", "Native plugin UI", false)?;
    // The projects this ONE engine is holding. Empty + disabled until it reports any; a row
    // per session, clicking it forgets that session (rebuilt by rebuild_sessions_menu).
    let sessions = Submenu::with_id(app, "sessions", "Sessions", false)?;
    // Stamped at compile time by build.rs (YYYYMMDD.HHMM, or "dev" for a bare cargo build).
    let build = MenuItem::with_id(
        app,
        "build",
        format!("build {}", env!("STUDIO_BUILD")),
        false,
        None::<&str>,
    )?;
    // Empty + disabled until the engine reports devices (rebuilt by rebuild_audio_menu).
    let audio = Submenu::with_id(app, "audio", "Audio interface", false)?;
    // The web UIs allowed to reach this engine. Always enabled: it holds "Add…" even when empty, which is when
    // you need it most.
    let weburi = Submenu::with_id(app, "weburi", "Web UI", true)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let start = MenuItem::with_id(app, "start", "Start engine", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop engine", false, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart engine", false, None::<&str>)?;
    // Restart just the file service, which can die on its own and leave the engine fine but the web UI fileless.
    // Enabled only when we own a running engine, since only then is there a file service of ours.
    let restart_file =
        MenuItem::with_id(app, "restart_file", "Restart file service", false, None::<&str>)?;
    // Clear the waveform cache (memo + .cache sidecars); enabled only when we can reach our own file service.
    let clear_waveform_cache = MenuItem::with_id(
        app,
        "clear_waveform_cache",
        "Clear waveform cache",
        false,
        None::<&str>,
    )?;
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
    let quit = PredefinedMenuItem::quit(app, Some("Quit studio-capot"))?;

    let items: Vec<&dyn IsMenuItem<Wry>> = vec![
        &status, &registry, &plugins, &rescan, &sessions, &edit_plugins, &audio, &weburi, &sep1,
        &start, &stop, &restart, &restart_file, &clear_waveform_cache, &sep2, &autostart, &open_root, &open_log,
        &sep3, &build, &quit,
    ];
    let menu = Menu::with_items(app, &items)?;

    Ok(MenuBuild {
        menu,
        status,
        registry,
        plugins,
        rescan,
        sessions,
        edit_plugins,
        audio,
        weburi,
        start,
        stop,
        restart,
        restart_file,
        clear_waveform_cache,
        autostart,
    })
}

/// Rebuild "Sessions ▸" — one row per project this engine is holding, each row dropping that
/// session. Cleared wholesale like the others; gated on `sessions_sig` so a moving playhead
/// never tears down a submenu the user has open.
///
/// The label is the whole point of the feature: "l8 · ma-chanson · 4 l8 ▶ · 1 écoute"
/// is what the status line could never say. Before sessions there was one project and the
/// tray had nothing to list; now the answer to "what is my engine doing, and for whom" lives
/// here.
pub fn rebuild_sessions_menu(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (submenu, sessions) = {
        let s = shared.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        (m.sessions.clone(), s.snapshot.sessions.clone())
    };
    while matches!(submenu.remove_at(0), Ok(Some(_))) {}

    if sessions.is_empty() {
        // Disabled placeholder rather than an empty submenu, for the same reason the plugin
        // one has it: an empty menu reads as broken, a sentence reads as a fact.
        if let Ok(item) = MenuItem::with_id(
            app,
            "sessions_none",
            "No app is driving this engine",
            false,
            None::<&str>,
        ) {
            let _ = submenu.append(&item);
        }
    } else {
        for s in &sessions {
            // The default session has no name on the wire; it has to have one here, or the
            // row would read as a session with no id rather than THE unnamed one.
            let who = if s.id.is_empty() {
                "(default)".to_string()
            } else {
                s.id.clone()
            };
            let what = if !s.loaded {
                " · nothing loaded".to_string()
            } else {
                format!(
                    " · {} · {} track{}",
                    if s.project.is_empty() { "untitled" } else { &s.project },
                    s.tracks,
                    if s.tracks == 1 { "" } else { "s" }
                )
            };
            // Two live facts, and only when true: a row full of "▶ no · 0 listening" would
            // bury the one session that IS playing among the ones that are not.
            let live = format!(
                "{}{}",
                if s.playing { "  ▶" } else { "" },
                match s.listeners {
                    0 => String::new(),
                    1 => "  ♫1".to_string(),
                    n => format!("  ♫{n}"),
                }
            );
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("session_drop:{}", s.id),
                format!("{who}{what}{live}   ✕"),
                true,
                None::<&str>,
            ) {
                let _ = submenu.append(&item);
            }
        }
    }
    let _ = submenu.set_enabled(true);
}

/// Rebuild "Native plugin UI ▸" from the project's plugin instances — externals only, built-ins having no
/// native editor — and disable it when there is nothing to open. Cleared wholesale, like rebuild_audio_menu:
/// separators would otherwise pile up one copy per rebuild, and this runs every few seconds.
pub fn rebuild_edit_plugins_menu(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (submenu, plugins) = {
        let s = shared.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        (m.edit_plugins.clone(), s.snapshot.edit_plugins.clone())
    };
    while matches!(submenu.remove_at(0), Ok(Some(_))) {}

    // Only plugins whose native editor can open. A built-ins-only project shows a disabled "No plugins with a
    // native UI", so the submenu doesn't read as "not loaded".
    let openable: Vec<&crate::host::EditPlugin> =
        plugins.iter().filter(|p| p.has_native_plugin_ui).collect();
    if openable.is_empty() {
        if let Ok(item) = MenuItem::with_id(
            app,
            "edit_plugins_none",
            "No plugins with a native UI",
            false,
            None::<&str>,
        ) {
            let _ = submenu.append(&item);
        }
    } else {
        for p in &openable {
            // The label carries the module name — what the user authored; the full id is only the click payload.
            let label = if p.name.is_empty() {
                p.id.clone()
            } else {
                p.name.clone()
            };
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("plugin_open:{}", p.id),
                label,
                true,
                None::<&str>,
            ) {
                let _ = submenu.append(&item);
            }
        }
    }
    let _ = submenu.set_enabled(!openable.is_empty());
}
///
/// Cleared wholesale rather than tracking what it added, like rebuild_weburi_menu: separators and nested
/// submenus can't live in a typed Vec and would pile up per rebuild — and this runs every 2s.
pub fn rebuild_audio_menu(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (submenu, devices, preferred, fallback) = {
        let s = shared.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        (
            m.audio.clone(),
            s.snapshot.audio_devices.clone(),
            s.snapshot.audio_preferred.clone(),
            s.snapshot.audio_fallback.clone(),
        )
    };
    while matches!(submenu.remove_at(0), Ok(Some(_))) {}

    for d in &devices {
        let mut label = if d.device_type.is_empty() {
            d.name.clone()
        } else {
            format!("{} [{}]", d.name, d.device_type)
        };
        // Mark the remembered pick when the engine ISN'T on it: that gap is what needs explaining.
        if preferred.as_deref() == Some(d.name.as_str()) && !d.current {
            label.push_str("   (preferred)");
        }
        if let Ok(item) = CheckMenuItem::with_id(
            app,
            format!("dev:{}", d.name),
            label,
            true,
            d.current,
            None::<&str>,
        ) {
            let _ = submenu.append(&item);
        }
    }

    // A remembered pick absent from the list still gets a row, or "why am I not on my interface?" has no answer.
    if let Some(p) = preferred.as_deref() {
        if !devices.iter().any(|d| d.name == p) {
            if let Ok(item) = MenuItem::with_id(
                app,
                "dev_missing",
                format!("{p}   (preferred — not connected)"),
                false,
                None::<&str>,
            ) {
                let _ = submenu.append(&item);
            }
        }
    }

    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        let _ = submenu.append(&sep);
    }

    // The fallback picker, nested: what to switch to when the pick above is gone.
    let title = match fallback.as_deref() {
        Some(f) => format!("Fallback: {f}"),
        None => "Fallback: none".to_string(),
    };
    if let Ok(fb) = Submenu::with_id(app, "audio_fallback", title, true) {
        if let Ok(none) = CheckMenuItem::with_id(
            app,
            "fb:",
            "None",
            true,
            fallback.is_none(),
            None::<&str>,
        ) {
            let _ = fb.append(&none);
        }
        for d in &devices {
            if let Ok(item) = CheckMenuItem::with_id(
                app,
                format!("fb:{}", d.name),
                d.name.clone(),
                true,
                fallback.as_deref() == Some(d.name.as_str()),
                None::<&str>,
            ) {
                let _ = fb.append(&item);
            }
        }
        // Same courtesy: keep a configured-but-absent fallback visible, so it can be seen and cleared.
        if let Some(f) = fallback.as_deref() {
            if !devices.iter().any(|d| d.name == f) {
                if let Ok(item) = MenuItem::with_id(
                    app,
                    "fb_missing",
                    format!("{f}   (not connected)"),
                    false,
                    None::<&str>,
                ) {
                    let _ = fb.append(&item);
                }
            }
        }
        let _ = submenu.append(&fb);
    }

    let _ = submenu.set_enabled(!devices.is_empty() || preferred.is_some());
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

const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// The "Plugins" line. The count arrives only after the scan, so while the engine is up but silent we animate
/// a spinner rather than show a bare "—", which reads like "none found".
fn plugins_label(running: bool, count: Option<usize>, spinner: usize) -> String {
    match (count, running) {
        (Some(n), _) => format!("Plugins: {n}"),
        (None, true) => format!("Plugins: {}", SPINNER_FRAMES[spinner % SPINNER_FRAMES.len()]),
        (None, false) => "Plugins: —".to_string(),
    }
}

/// Which badge the icon wears. `Running` alone isn't enough: an engine still scanning isn't usable yet, so it
/// gets the spinner — the same condition that animates the "Plugins" line.
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

/// Advance the spinner and repaint ONLY the plugins line and the icon: this ticks several times a second, and
/// nothing else can have changed between frames.
pub fn tick_spinner(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let (item, text, tray, icon) = {
        let mut s = shared.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        let (item, tray) = (m.plugins.clone(), m.tray.clone());
        s.spinner = s.spinner.wrapping_add(1);
        let running = s.running();
        let icon = trayicon::render_with(icon_state(&s), s.dark_menubar, s.snapshot.attention);
        (item, plugins_label(running, s.snapshot.plugin_count, s.spinner), tray, icon)
    };
    let _ = item.set_text(text);
    let _ = tray.set_icon(Some(icon));
}

/// Recompute labels, enabled-state and the icon. Locks the state only to snapshot it (cloning the menu handles
/// out), then makes the Tauri calls with the lock released.
pub fn refresh(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let snapshot = {
        let s = shared.lock().unwrap();
        let Some(m) = s.menus.as_ref() else {
            return;
        };
        let running = s.running();
        // The safety rule in one place: only an engine the SUPERVISOR spawned may be stopped or restarted from here.
        let owns = s.owns_running();
        let is_error = s.snapshot.status == "error";
        let status_text = if running {
            format!(
                "● Running{} · id {} · :{}",
                if owns { "" } else { " (adopted)" },
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
        // A dead file service shows on the status line too, not just the icon — the menu is where "red" is explained.
        let file_failed = s.snapshot.file_service_failed;
        let status_text = if file_failed && s.host_error.is_none() {
            format!("{status_text} · ⚠ file service down")
        } else {
            status_text
        };
        let registry_text = if running {
            format!(
                "registry {} · {}",
                s.snapshot.registry_url,
                if s.snapshot.last_heartbeat_ok {
                    "ok"
                } else {
                    "unreachable"
                }
            )
        } else {
            format!("registry {}", s.snapshot.registry_url)
        };
        let plugins_text = plugins_label(running, s.snapshot.plugin_count, s.spinner);
        (
            status_text,
            registry_text,
            plugins_text,
            running,
            owns,
            m.status.clone(),
            m.registry.clone(),
            m.plugins.clone(),
            m.start.clone(),
            m.stop.clone(),
            m.restart.clone(),
            m.restart_file.clone(),
            m.clear_waveform_cache.clone(),
            m.rescan.clone(),
            m.tray.clone(),
            is_error,
            file_failed,
            trayicon::render_with(icon_state(&s), s.dark_menubar, s.snapshot.attention),
        )
    };
    let (
        status_text,
        registry_text,
        plugins_text,
        running,
        owns,
        status_item,
        registry_item,
        plugins_item,
        start_item,
        stop_item,
        restart_item,
        restart_file_item,
        clear_waveform_item,
        rescan_item,
        tray,
        is_error,
        file_failed,
        icon,
    ) = snapshot;

    let _ = status_item.set_text(status_text);
    let _ = registry_item.set_text(registry_text);
    let _ = plugins_item.set_text(plugins_text);
    let _ = start_item.set_enabled(!running);
    let _ = stop_item.set_enabled(owns);
    let _ = restart_item.set_enabled(owns);
    // Only offer "Restart file service" when there is one of ours to restart — i.e. we own a running engine.
    let _ = restart_file_item.set_enabled(owns);
    // Same condition: clearing the cache is an HTTP call to OUR file service.
    let _ = clear_waveform_item.set_enabled(owns);
    // "Rescan plugins" needs the engine running — it sends a WebSocket command.
    let _ = rescan_item.set_enabled(running);

    let _ = tray.set_icon(Some(icon));
    let tip = if file_failed {
        "studio-moteur — file service stopped"
    } else if running {
        "studio-moteur — running"
    } else if is_error {
        "studio-moteur — error"
    } else {
        "studio-moteur — stopped"
    };
    let _ = tray.set_tooltip(Some(tip));
}

/// Handle a tray menu click. `quit` is a predefined item and is not routed here.
pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "start" => start_engine(app),
        // One command, not stop-then-start: the supervisor sequences it, so no crash-watch tick sees the gap and
        // "recovers" mid-restart.
        "restart" => restart_engine(app),
        "stop" => stop_engine(app),
        "restart_file" => restart_file_service(app),
        "clear_waveform_cache" => clear_waveform_cache(app),
        "rescan" => rescan_plugins(app),
        "autostart" => toggle_autostart(app),
        "open_root" => open_root(app),
        "open_log" => {
            let p = app.state::<SharedState>().lock().unwrap().snapshot.paths.merged_log.clone();
            open_text_file(std::path::Path::new(&p));
        }
        "weburi_add" => add_web_ui(app),
        _ if id.starts_with("dev:") => select_audio_device(app, &id["dev:".len()..]),
        _ if id.starts_with("fb:") => select_audio_fallback(app, &id["fb:".len()..]),
        // Dropping a session throws away whatever the app driving it had loaded, so the row
        // IS the drop and its label says so — there is no other click on a session row that
        // this could be mistaken for.
        _ if id.starts_with("session_drop:") => {
            host::send(app, "session.drop", Some(&id["session_drop:".len()..]));
        }
        _ if id.starts_with("plugin_open:") => {
            open_native_plugin_ui(app, &id["plugin_open:".len()..])
        }
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
/// that FOLLOWS is the supervisor's. `weburi.add` has two effects there, a l8 web UI being single-origin:
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
    set r to display dialog "Add a l8 web UI. Its address is allowed to reach this engine." with title "studio-capot" default answer "https://" with icon note buttons {"Cancel", "Add"} default button "Add"
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
            "display dialog {} with title \"studio-capot\" buttons {{\"OK\"}} default button \"OK\" with icon caution",
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

/// Record the fallback interface (empty id = none). Switches nothing now — it says where to go if the pick goes.
fn select_audio_fallback(app: &AppHandle, name: &str) {
    // The supervisor persists it, clears its retry guard so a new fallback gets a fresh attempt, and echoes it
    // back in the next snapshot — which is what redraws the submenu.
    host::send(app, "audio.fallback", Some(name));
}

/// Switch the engine to the clicked interface. The click is also REMEMBERED as the preferred device, which is
/// what lets the reconcile loop restore it after an unplug — both halves happen in the supervisor.
fn select_audio_device(app: &AppHandle, name: &str) {
    host::send(app, "audio.select", Some(name));
}

/// Open a plugin's native editor from the submenu; the id is the PluginDoc id the row was built from.
fn open_native_plugin_ui(app: &AppHandle, id: &str) {
    host::send(app, "plugin.showUI", Some(id));
}

// Every one of these used to spawn, kill and watch processes here; they are single lines on the pipe now.
// The supervisor owns the engine and file service, so the tray can't get out of step with it — and a click
// never blocks the menu thread on a kill, a port probe or an HTTP round-trip.

fn start_engine(app: &AppHandle) {
    host::send(app, "engine.start", None);
}

fn stop_engine(app: &AppHandle) {
    host::send(app, "engine.stop", None);
}

fn restart_engine(app: &AppHandle) {
    host::send(app, "engine.restart", None);
}

fn restart_file_service(app: &AppHandle) {
    host::send(app, "fileService.restart", None);
}

/// Clear the waveform cache, memo and .cache sidecars alike. Destructive: the next request re-decodes.
fn clear_waveform_cache(app: &AppHandle) {
    host::send(app, "waveforms.clear", None);
}


/// Ask the engine to re-scan installed plugins. The supervisor clears the count first, so the spinner appears
/// in the very next snapshot, and deletes the on-disk scan cache — without which a rescan returns the stale list.
fn rescan_plugins(app: &AppHandle) {
    host::send(app, "plugins.rescan", None);
}

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
    let (weburi_changed, audio_changed, edit_changed, sessions_changed) = {
        let shared = app.state::<SharedState>();
        let mut s = shared.lock().unwrap();
        let weburi_changed = s.snapshot.web_origins != snapshot.web_origins
            || s.snapshot.web_pending != snapshot.web_pending;
        // The rebuilt submenus are gated on the SUPERVISOR's signatures, not on comparing arrays: tearing down and
        // re-adding every row of a submenu the user may have open, because a heartbeat flipped, is visible churn.
        let audio_changed = s.drawn_audio_sig != snapshot.audio_menu_sig;
        let edit_changed = s.drawn_edit_sig != snapshot.edit_plugins_sig;
        if audio_changed {
            s.drawn_audio_sig = snapshot.audio_menu_sig.clone();
        }
        if edit_changed {
            s.drawn_edit_sig = snapshot.edit_plugins_sig.clone();
        }
        let sessions_changed = s.drawn_sessions_sig != snapshot.sessions_sig;
        if sessions_changed {
            s.drawn_sessions_sig = snapshot.sessions_sig.clone();
        }
        s.snapshot = snapshot;
        // A snapshot arriving IS the supervisor working, so whatever we last complained about is over.
        s.host_error = None;
        (weburi_changed, audio_changed, edit_changed, sessions_changed)
    };
    if audio_changed {
        rebuild_audio_menu(app);
    }
    if edit_changed {
        rebuild_edit_plugins_menu(app);
    }
    if sessions_changed {
        rebuild_sessions_menu(app);
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
