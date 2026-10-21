// state.rs — the little the tray knows, behind Arc<Mutex<>>: where its backend stands, what the backend last said
// the engine is doing, and the menu handles that show it. Nothing here is computed: the words come from the backend.

use std::sync::{Arc, Mutex};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIcon;
use tauri::Wry;

/// The backend's status route, verbatim (apps/k7/backend/src/localEngine/trayStatus.ts).
#[derive(Clone, Default, serde::Deserialize, PartialEq)]
pub struct Said {
    /// "stopped" | "loading" | "running" | "error"
    pub icon: String,
    pub line: String,
    pub downloads: Option<String>,
}

/// Where the backend process stands, which the tray does know first-hand.
#[derive(Clone, PartialEq)]
pub enum Backend {
    Starting,
    /// Answering: the page can be opened, and the status route is asked.
    Ready,
    /// Gone, with why; a restart may be coming.
    Down(String),
}

/// Handles mutated as the status changes. Stored once during setup.
pub struct Menus {
    pub status: MenuItem<Wry>,
    /// The line under it while an instrument downloads, in the menu only then.
    pub downloads: MenuItem<Wry>,
    pub downloads_shown: bool,
    pub open: MenuItem<Wry>,
    pub menu: Menu<Wry>,
    pub autostart: CheckMenuItem<Wry>,
    pub auto_update: CheckMenuItem<Wry>,
    pub tray: TrayIcon<Wry>,
}

pub struct AppState {
    pub backend: Backend,
    pub said: Said,
    /// The bearer the backend checks on its status route, handed to it at spawn.
    pub token: String,
    pub port: u16,
    pub spinner: usize,
    pub dark_menubar: bool,
    pub menus: Option<Menus>,
}

pub type SharedState = Arc<Mutex<AppState>>;
