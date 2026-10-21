// loops.rs — the tray's background threads: asking the backend what to say, turning the spinner, and following the
// menu bar's appearance. Each takes the state's lock only to read or write it, never across a request or a sleep.

use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::state::{Backend, Said, SharedState};
use crate::{http, tray, trayicon};

pub fn start(app: &AppHandle) {
    let a = app.clone();
    std::thread::spawn(move || status_loop(a));
    let b = app.clone();
    std::thread::spawn(move || spinner_loop(b));
    let c = app.clone();
    std::thread::spawn(move || appearance_loop(c));
}

/// Once a second while the backend answers: its words for the icon and the menu, redrawn only when they change.
fn status_loop(app: AppHandle) {
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let (ready, port, token) = {
            let s = app.state::<SharedState>();
            let s = s.lock().unwrap();
            (s.backend == Backend::Ready, s.port, s.token.clone())
        };
        if !ready {
            continue;
        }
        let said = match http::get(port, "/api/local/tray", Some(&token)) {
            Some((200, body)) => serde_json::from_str::<Said>(&body).ok(),
            _ => None,
        };
        let Some(said) = said else { continue };
        let changed = {
            let shared = app.state::<SharedState>();
            let mut s = shared.lock().unwrap();
            let changed = s.said != said;
            s.said = said;
            changed
        };
        if changed {
            tray::refresh(&app);
        }
    }
}

/// 8 frames a second while something is starting; idle otherwise.
fn spinner_loop(app: AppHandle) {
    loop {
        let busy = {
            let s = app.state::<SharedState>();
            let s = s.lock().unwrap();
            s.backend == Backend::Starting || (s.backend == Backend::Ready && s.said.icon == "loading")
        };
        if busy {
            tray::tick_spinner(&app);
            std::thread::sleep(Duration::from_millis(120));
        } else {
            std::thread::sleep(Duration::from_millis(500));
        }
    }
}

/// The icon's ink follows the menu bar; nothing pushes a theme change, and switching one is a human act, so 5 s.
fn appearance_loop(app: AppHandle) {
    loop {
        let dark = trayicon::menubar_is_dark();
        let changed = {
            let shared = app.state::<SharedState>();
            let mut s = shared.lock().unwrap();
            let changed = s.dark_menubar != dark;
            s.dark_menubar = dark;
            changed
        };
        if changed {
            tray::refresh(&app);
        }
        std::thread::sleep(Duration::from_secs(5));
    }
}
