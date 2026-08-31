// main.rs — the st0 tray app: a windowless Tauri tray that is the VIEW over the
// supervisor (@studio/engine-host), spawned as a child and driven over NDJSON on stdio.
// The Windows job object is created HERE, before anything is spawned, so a force-killed
// tray takes the whole stack with it. See docs/tray.md.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod host;
mod hostcmd;
mod job;
mod logbus;
mod paths;
mod pidkill;
mod state;
mod supervisor;
mod tray;
mod trayicon;

use std::sync::{Arc, Mutex};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

use state::{AppState, Menus, SharedState};

fn main() {
    tauri::Builder::default()
        // single-instance FIRST — a second launch is a no-op (there's no window to focus).
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Menu-bar only on macOS: no Dock icon, no app-switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();

            // Create the kill-on-close job BEFORE spawning anything: membership is inherited, so the whole stack dies with
            // the tray even on a force-kill. A no-op off Windows, where the closing stdin pipe plays the same role.
            job::init();

            // Truncate the merged log for this session, before the supervisor opens it for append — a relaunch must not.
            logbus::init();

            let autostart_on = handle.autolaunch().is_enabled().unwrap_or(false);

            let mb = tray::build_menu(&handle, autostart_on)?;
            let dark = trayicon::menubar_is_dark();
            let tray = TrayIconBuilder::with_id("main")
                .icon(trayicon::render(trayicon::IconState::Stopped, dark))
                .tooltip("studio-moteur")
                .menu(&mb.menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| tray::on_menu(app, event.id.as_ref()))
                .build(&handle)?;

            let menus = Menus {
                status: mb.status,
                registry: mb.registry,
                plugins: mb.plugins,
                rescan: mb.rescan,
                sessions: mb.sessions,
                edit_plugins: mb.edit_plugins,
                audio: mb.audio,
                weburi: mb.weburi,
                start: mb.start,
                stop: mb.stop,
                restart: mb.restart,
                restart_file: mb.restart_file,
                clear_waveform_cache: mb.clear_waveform_cache,
                autostart: mb.autostart,
                tray,
            };

            let shared: SharedState = Arc::new(Mutex::new(AppState {
                snapshot: Default::default(),
                host_error: None,
                spinner: 0,
                dark_menubar: dark,
                drawn_audio_sig: String::new(),
                drawn_edit_sig: String::new(),
                drawn_sessions_sig: String::new(),
                menus: Some(menus),
            }));
            app.manage(shared);

            // Start the supervisor: it brings the engine and file service up itself, and its snapshots are what we draw.
            host::spawn(&handle);
            supervisor::start_loops(&handle);

            // SIGTERM/SIGINT clean up like menu Quit: launchd stops a LaunchAgent that way, and Ctrl-C in dev should too.
            #[cfg(unix)]
            {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    use tokio::signal::unix::{signal, SignalKind};
                    let mut term = signal(SignalKind::terminate()).expect("SIGTERM");
                    let mut int = signal(SignalKind::interrupt()).expect("SIGINT");
                    tokio::select! {
                        _ = term.recv() => {},
                        _ = int.recv() => {},
                    }
                    cleanup(&h);
                    std::process::exit(0); // bypass the run-loop; cleanup already ran
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Menu Quit / Cmd-Q (the run loop); SIGTERM and SIGINT go through the async signal task above.
                cleanup(app_handle);
            }
        });
}

/// On quit: ask the supervisor to tear the stack down, then make sure it did.
///
/// The supervisor deregisters and stops both processes, foreign or not — closing the app is terminal.
/// `backstop` is the second half: a supervisor killed past its deadline never stopped the engine. This does.
fn cleanup(app: &tauri::AppHandle) {
    host::shutdown_and_wait(app);
    pidkill::backstop();
}
