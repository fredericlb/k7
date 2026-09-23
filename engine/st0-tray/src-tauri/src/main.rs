// main.rs — the st0 tray app: a Tauri tray that is the VIEW over the supervisor
// (@studio/engine-host), spawned as a child and driven over NDJSON on stdio. It starts
// with no window and opens exactly one on demand, the settings window (settingswin.rs).
// The Windows job object is created HERE, before anything is spawned, so a force-killed
// tray takes the whole stack with it. See docs/tray.md.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod deps;
mod host;
mod hostcmd;
mod job;
mod logbus;
mod paths;
mod pidkill;
mod settingswin;
mod state;
mod supervisor;
mod tray;
mod trayicon;

use std::sync::{Arc, Mutex};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use state::{AppState, Menus, SharedState};

fn main() {
    tauri::Builder::default()
        // The settings window's calls; nothing else in this app has a webview to make one.
        .invoke_handler(tauri::generate_handler![
            settingswin::settings_view,
            settingswin::audio_rank,
            settingswin::sync_targets,
            settingswin::instance_add,
            settingswin::instance_remove,
            settingswin::instance_allow,
            settingswin::instance_deny,
            settingswin::plugins_rescan,
            settingswin::session_drop,
            settingswin::plugin_show_ui,
            settingswin::engine_start,
            settingswin::engine_stop,
            settingswin::engine_restart,
            settingswin::file_service_restart,
            settingswin::waveforms_clear,
            settingswin::settings_close
        ])
        // single-instance FIRST — a second launch is a no-op: the tray icon is the way in.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Menu-bar only on macOS: no Dock icon, no app-switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();

            // The CLIs the file service shells out to, before ANY of the stack exists: without them a
            // workspace cannot be imported, and every symptom of that lands far from this cause.
            if let Some(message) = deps::missing() {
                handle
                    .dialog()
                    .message(message)
                    .title("st0")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
                std::process::exit(1); // nothing is running yet, so there is nothing for cleanup() to do
            }

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
                .tooltip("st0-engine")
                .menu(&mb.menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| tray::on_menu(app, event.id.as_ref()))
                .build(&handle)?;

            let menus = Menus {
                status: mb.status,
                autostart: mb.autostart,
                tray,
            };

            let shared: SharedState = Arc::new(Mutex::new(AppState {
                snapshot: Default::default(),
                host_error: None,
                spinner: 0,
                dark_menubar: dark,
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
