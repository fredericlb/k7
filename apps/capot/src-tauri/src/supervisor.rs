// supervisor.rs — the tray's remaining background loops (the name is a misnomer: the real
// supervisor is @lanes/engine-host). Only `spinner_loop` and `appearance_loop` are left,
// both genuinely view work. Every loop DROPS its lock guard before any `.await`.
// See docs/tray.md.

use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::state::SharedState;
use crate::{tray, trayicon};

pub fn start_loops(app: &AppHandle) {
    let a = app.clone();
    tauri::async_runtime::spawn(async move { appearance_loop(a).await });
    let d = app.clone();
    tauri::async_runtime::spawn(async move { spinner_loop(d).await });
}

// Animate the "Plugins" line while the engine is up but hasn't reported a count; idles once it has.
async fn spinner_loop(app: AppHandle) {
    loop {
        let pending = {
            let s = app.state::<SharedState>();
            let s = s.lock().unwrap();
            s.running() && s.snapshot.plugin_count.is_none()
        };
        if pending {
            tray::tick_spinner(&app);
            tokio::time::sleep(Duration::from_millis(120)).await;
        } else {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
}

// Keep the icon's ink matching the menu bar. Nothing pushes us a theme change, so this polls — pure view work,
// which is why it stayed. 5s, the heartbeat's old cadence: a theme switch is a human action.
async fn appearance_loop(app: AppHandle) {
    let mut ticker = tokio::time::interval(Duration::from_secs(5)); // first tick immediate
    loop {
        ticker.tick().await;
        let dark = trayicon::menubar_is_dark();
        let changed = {
            let shared = app.state::<SharedState>();
            let mut s = shared.lock().unwrap();
            (s.dark_menubar != dark).then(|| s.dark_menubar = dark)
        };
        if changed.is_some() {
            tray::refresh(&app);
        }
    }
}
