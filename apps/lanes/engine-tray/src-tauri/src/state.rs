// state.rs — the tray's state behind Arc<Mutex<>>, plus the menu handles reflecting it.
// Two halves: `snapshot` is what the SUPERVISOR reported (never computed or written here),
// and the rest is the little view state the tray genuinely owns. See docs/tray.md.

use std::sync::{Arc, Mutex};
use tauri::menu::{CheckMenuItem, MenuItem, Submenu};
use tauri::tray::TrayIcon;
use tauri::Wry;

use crate::host::Snapshot;

/// Handles we mutate as status changes. Stored once in AppState during setup.
pub struct Menus {
    pub status: MenuItem<Wry>,
    pub registry: MenuItem<Wry>,
    pub plugins: MenuItem<Wry>, // "Plugins: N" (disabled status line, the scan count)
    pub rescan: MenuItem<Wry>,  // "Rescan plugins" — enabled only when engine is running
    // "Native plugin UI ▸" — the loaded project's external plugin instances. Distinct from `plugins` (the global
    // scan count) and from a module's moduleUI, the widget grid built in the web editor and not surfaced here.
    pub edit_plugins: Submenu<Wry>,
    pub audio: Submenu<Wry>, // "Audio interface ▸" — rebuilt as devices change
    pub weburi: Submenu<Wry>, // "Web UI ▸" — rebuilt as the allowed origins change
    pub start: MenuItem<Wry>,
    pub stop: MenuItem<Wry>,
    pub restart: MenuItem<Wry>,
    pub restart_file: MenuItem<Wry>, // "Restart file service" — the fix for a dead file service
    // "Clear waveform cache", held here so refresh() can enable it: it was built and routed but never reached this
    // struct, so nothing called set_enabled and the row stayed dead over a working handler.
    pub clear_waveform_cache: MenuItem<Wry>,
    pub autostart: CheckMenuItem<Wry>,
    pub tray: TrayIcon<Wry>,
}

pub struct AppState {
    /// The supervisor's last report. Replaced wholesale on every `state` frame.
    pub snapshot: Snapshot,
    /// The supervisor is missing or restarting — outranks every other status: there is nothing behind the green dot.
    pub host_error: Option<String>,

    /// Frame index for the "Plugins" spinner, advanced while the engine is up but still scanning.
    pub spinner: usize,
    /// Cached menu-bar appearance, so a background task can draw the icon with the right ink.
    pub dark_menubar: bool,
    /// The signatures the two rebuilt submenus were last DRAWN from (the supervisor computes them), so a snapshot
    /// changing something else doesn't tear down and re-add every row of a submenu the user may have open.
    pub drawn_audio_sig: String,
    pub drawn_edit_sig: String,
    pub menus: Option<Menus>,
}

impl AppState {
    /// Is the engine up, per the supervisor?
    pub fn running(&self) -> bool {
        self.snapshot.status == "running"
    }
    /// Can we act on the engine — is it one the supervisor SPAWNED? A foreign engine shows running with Stop and
    /// Restart greyed out, so this app can never kill a process another owner manages.
    pub fn owns_running(&self) -> bool {
        self.running() && self.snapshot.owns_engine
    }
}

pub type SharedState = Arc<Mutex<AppState>>;
