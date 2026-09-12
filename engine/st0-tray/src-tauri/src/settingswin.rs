// settingswin.rs — the tray's one window, in four tabs: the audio ranking as a drag list, the
// installed plugin catalogue, the sessions this engine is holding, and the machine itself.
// Like tray.rs it is a VIEW: it draws the supervisor's snapshot and sends commands back,
// computing nothing. Closing HIDES it — Tauri asks a windowless app to exit, and this app's
// exit stops the engine. See docs/tray.md.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::host::{self, EditPlugin, Plugin, Session, Snapshot, SyncTarget};
use crate::logbus;
use crate::state::SharedState;
use crate::tray;

/// The window's label, and the event target a push names — so it reaches this window and no other.
const LABEL: &str = "settings";

/// One interface as the list draws it. `rank` is the row's own place, so the page looks nothing up.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRow {
    name: String,
    device_type: String,
    /// Plugged in right now. A ranked name with nothing behind it still gets a row: it is what holds the rank.
    present: bool,
    current: bool,
    /// 1-based place in the ranking; None for a device that is merely visible.
    rank: Option<usize>,
}

/// One plugin instance whose native editor can open. It carries its own session because the
/// engine holds N, and a bare id names one row PER session.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiRow {
    session: String,
    id: String,
    /// The module name the user authored; the id is only the click payload.
    name: String,
}

/// One project this engine is holding, with the plugin windows it can open beneath it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    id: String,
    project: String,
    loaded: bool,
    playing: bool,
    tracks: usize,
    listeners: usize,
    plugins: Vec<PluginUiRow>,
}

/// The System tab: what this machine is running, and what may be done to it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemView {
    /// Stamped at compile time by build.rs — `YYYYMMDD.HHMM`, or "dev" for a bare cargo build.
    build: String,
    status: String,
    error: Option<String>,
    /// A missing supervisor REPLACES the engine's own story: there is nothing behind the green dot.
    host_error: Option<String>,
    engine_id: String,
    engine_port: u16,
    owns_engine: bool,
    registry_url: String,
    last_heartbeat_ok: bool,
    file_port: u16,
    file_service_failed: bool,
    can_start: bool,
    /// Stop, both Restarts and the cache belong ONLY to an engine this supervisor spawned.
    can_act: bool,
}

/// What the page draws. An empty list means two different things, and only the engine's state tells them apart.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    audio: Vec<AudioRow>,
    plugins: Vec<Plugin>,
    /// None while the engine has not answered: the page says "scanning…", never "none installed".
    plugin_count: Option<usize>,
    sessions: Vec<SessionRow>,
    /// Where this machine may copy a set list. Drawn verbatim — the page adds and removes, nothing else.
    sync_targets: Vec<SyncTarget>,
    /// Openable plugins naming a session the engine did not list — the two are polled apart, and a
    /// row must not vanish because they disagreed for one frame.
    orphan_plugins: Vec<PluginUiRow>,
    engine_running: bool,
    system: SystemView,
}

/// The sessions, each carrying the plugins that name it, plus whatever named no listed session.
fn session_rows(
    sessions: &[Session],
    plugins: &[EditPlugin],
) -> (Vec<SessionRow>, Vec<PluginUiRow>) {
    // Only plugins whose native editor can open: a built-in has no window to show.
    let openable: Vec<&EditPlugin> = plugins.iter().filter(|p| p.has_native_plugin_ui).collect();
    let row = |p: &EditPlugin| PluginUiRow {
        session: p.session.clone(),
        id: p.id.clone(),
        name: if p.name.is_empty() {
            p.id.clone()
        } else {
            p.name.clone()
        },
    };
    let rows: Vec<SessionRow> = sessions
        .iter()
        .map(|s| SessionRow {
            id: s.id.clone(),
            project: s.project.clone(),
            loaded: s.loaded,
            playing: s.playing,
            tracks: s.tracks,
            listeners: s.listeners,
            plugins: openable
                .iter()
                .filter(|p| p.session == s.id)
                .map(|p| row(p))
                .collect(),
        })
        .collect();
    let orphans = openable
        .iter()
        .filter(|p| !sessions.iter().any(|s| s.id == p.session))
        .map(|p| row(p))
        .collect();
    (rows, orphans)
}

/// The interfaces in the order the engine consults them: the ranking first, then whatever else is plugged in.
fn audio_rows(devices: &[host::AudioDevice], priority: &[String]) -> Vec<AudioRow> {
    let unranked = devices
        .iter()
        .filter(|d| !priority.contains(&d.name))
        .map(|d| d.name.clone());
    priority
        .iter()
        .cloned()
        .chain(unranked)
        .enumerate()
        .map(|(i, name)| {
            let d = devices.iter().find(|d| d.name == name);
            AudioRow {
                device_type: d.map(|d| d.device_type.clone()).unwrap_or_default(),
                present: d.is_some(),
                current: d.map(|d| d.current).unwrap_or(false),
                rank: (i < priority.len()).then_some(i + 1),
                name,
            }
        })
        .collect()
}

fn view(app: &AppHandle) -> View {
    let shared = app.state::<SharedState>();
    let s = shared.lock().unwrap();
    let snap = &s.snapshot;
    let (sessions, orphan_plugins) = session_rows(&snap.sessions, &snap.edit_plugins);
    View {
        audio: audio_rows(&snap.audio_devices, &snap.audio_priority),
        plugins: snap.plugins.clone(),
        plugin_count: snap.plugin_count,
        sessions,
        orphan_plugins,
        sync_targets: snap.sync_targets.clone(),
        engine_running: s.running(),
        system: SystemView {
            build: env!("STUDIO_BUILD").to_string(),
            status: snap.status.clone(),
            error: snap.error.clone(),
            host_error: s.host_error.clone(),
            engine_id: snap.engine_id.clone(),
            engine_port: snap.engine_port,
            owns_engine: snap.owns_engine,
            registry_url: snap.registry_url.clone(),
            last_heartbeat_ok: snap.last_heartbeat_ok,
            file_port: snap.file_port,
            file_service_failed: snap.file_service_failed,
            can_start: !s.running(),
            can_act: s.owns_running(),
        },
    }
}

/// Whether a new snapshot changes anything this window DRAWS. Field by field rather than by
/// serialising the view and comparing: the catalogue is hundreds of rows and this runs on every frame.
pub fn differs(a: &Snapshot, b: &Snapshot) -> bool {
    a.audio_menu_sig != b.audio_menu_sig
        || a.sync_targets != b.sync_targets
        || a.plugins_sig != b.plugins_sig
        || a.plugin_count != b.plugin_count
        || a.sessions_sig != b.sessions_sig
        || a.edit_plugins_sig != b.edit_plugins_sig
        || a.status != b.status
        || a.error != b.error
        || a.owns_engine != b.owns_engine
        || a.engine_id != b.engine_id
        || a.engine_port != b.engine_port
        || a.file_port != b.file_port
        || a.file_service_failed != b.file_service_failed
        || a.registry_url != b.registry_url
        || a.last_heartbeat_ok != b.last_heartbeat_ok
}

/// What the page asks for once, on load; every change after that arrives as a push.
#[tauri::command]
pub fn settings_view(app: AppHandle) -> View {
    view(&app)
}

/// A drop commits every visible row, which is how one move ranks a machine that had ranked nothing.
#[tauri::command]
pub fn audio_rank(app: AppHandle, names: Vec<String>) {
    tray::send_audio_priority(&app, &names);
}

/// The WHOLE list in one command, as the ranking is: an edit is one act. The supervisor's
/// normaliser is what refuses a URI nothing can copy to, so this sends what is on screen.
#[tauri::command]
pub fn sync_targets(app: AppHandle, targets: Vec<SyncTarget>) {
    let arg = serde_json::to_string(&targets).unwrap_or_else(|_| "[]".to_string());
    host::send(&app, "sync.targets", Some(&arg));
}

/// Rescan the installed plugins. The supervisor clears the count first, so the spinner is in the next snapshot.
#[tauri::command]
pub fn plugins_rescan(app: AppHandle) {
    host::send(&app, "plugins.rescan", None);
}

/// The System tab's buttons. The supervisor is what REFUSES to touch an engine it does not own —
/// `can_act` only greys the button, and a view is the wrong place for that rule to live.
#[tauri::command]
pub fn engine_start(app: AppHandle) {
    host::send(&app, "engine.start", None);
}

#[tauri::command]
pub fn engine_stop(app: AppHandle) {
    host::send(&app, "engine.stop", None);
}

/// One command, not stop-then-start: the supervisor sequences it, so no crash-watch tick sees the
/// gap and "recovers" mid-restart.
#[tauri::command]
pub fn engine_restart(app: AppHandle) {
    host::send(&app, "engine.restart", None);
}

#[tauri::command]
pub fn file_service_restart(app: AppHandle) {
    host::send(&app, "fileService.restart", None);
}

/// Clear the waveform cache, memo and `.cache` sidecars alike. Destructive: the next request re-decodes.
#[tauri::command]
pub fn waveforms_clear(app: AppHandle) {
    host::send(&app, "waveforms.clear", None);
}

/// Drop a session: it throws away whatever the app driving it had loaded. That app is not told,
/// and will simply find an empty project.
#[tauri::command]
pub fn session_drop(app: AppHandle, id: String) {
    host::send(&app, "session.drop", Some(&id));
}

/// Open one plugin's own editor window, on the ENGINE's screen. U+001F between the two halves,
/// matching hostProtocol.ts's SHOW_UI_SEP — the supervisor splits it.
#[tauri::command]
pub fn plugin_show_ui(app: AppHandle, session: String, id: String) {
    host::send(&app, "plugin.showUI", Some(&format!("{session}\u{1f}{id}")));
}

/// Escape, from the page. Hiding is Rust's job here for the same reason the close button's is.
#[tauri::command]
pub fn settings_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// Show the window, building it the first time. Reopening a hidden one is what a menu row usually does.
pub fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        push(app);
        return;
    }
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("settings.html".into()))
        .title("st0 engine")
        .inner_size(560.0, 640.0)
        .min_inner_size(380.0, 300.0)
        .center()
        .build();
    match built {
        Ok(w) => {
            let handle = app.clone();
            // Never let this window be DESTROYED: Tauri asks a windowless app to exit, and our exit stops the engine.
            w.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(w) = handle.get_webview_window(LABEL) {
                        let _ = w.hide();
                    }
                }
            });
            let _ = w.set_focus();
        }
        Err(e) => logbus::line("host", &format!("settings window won't open: {e}")),
    }
}

/// Redraw the open window from the new snapshot. A no-op when it was never opened, which is the usual case.
pub fn push(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_none() {
        return;
    }
    let _ = app.emit_to(LABEL, "settings:view", view(app));
}
