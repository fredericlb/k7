// main.rs — the k7 tray: a windowless Tauri app that starts k7's backend on 127.0.0.1, which runs the machine's
// supervisor and engine, and leads the browser to it — k7 is used as a web app (an installable one) on this
// machine. The Windows job object is created HERE, before anything spawns, so a force-killed tray takes the whole
// stack with it. It opens no window and has no webview. See docs/tray.md.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod backend;
mod http;
mod job;
mod logbus;
mod loops;
mod paths;
mod pidkill;
mod state;
mod tray;
mod trayicon;
mod updates;

use std::sync::{Arc, Mutex};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use state::{AppState, Backend, Menus, SharedState};

fn main() {
    let mut builder = tauri::Builder::default()
        // A second launch opens k7 in the browser: the tray is already there, which is what the person was after.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::open_path(&backend::url(app, "/"));
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init());
    if let Some(updater) = updates::plugin() {
        builder = builder.plugin(updater);
    }
    builder
        .manage(backend::Process::default())
        .setup(|app| {
            // Menu-bar only on macOS: no Dock icon, no app-switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();

            // Before anything spawns: job membership is inherited, so the whole stack dies with the tray.
            job::init();
            // One tray launch is one session of the merged log, truncated before the backend appends to it.
            logbus::init();
            logbus::line("host", &format!("k7 tray {} starting", env!("K7_RELEASE")));

            let autostart_on = handle.autolaunch().is_enabled().unwrap_or(false);
            let mb = tray::build_menu(&handle, autostart_on, updates::auto_enabled(&handle))?;
            let icon = TrayIconBuilder::with_id("main")
                .icon(trayicon::render(trayicon::IconState::Loading(0)))
                .tooltip("k7")
                .menu(&mb.menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| tray::on_menu(app, event.id.as_ref()))
                .build(&handle)?;

            let shared: SharedState = Arc::new(Mutex::new(AppState {
                backend: Backend::Starting,
                said: Default::default(),
                token: backend::random_hex(32),
                port: backend::port(&handle),
                spinner: 0,
                menus: Some(Menus {
                    status: mb.status,
                    downloads: mb.downloads,
                    downloads_shown: false,
                    open: mb.open,
                    menu: mb.menu,
                    autostart: mb.autostart,
                    auto_update: mb.auto_update,
                    tray: icon,
                }),
            }));
            app.manage(shared);

            backend::spawn(&handle);
            loops::start(&handle);
            updates::start(&handle);

            // SIGTERM/SIGINT stop like Quit: launchd stops a LaunchAgent that way, and Ctrl-C in dev should too.
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
                    std::process::exit(0);
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building the tray")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                cleanup(app);
            }
        });
}

/// On quit: the backend stops its supervisor, which deregisters and stops the engine; the backstop catches what a
/// hung one left behind.
fn cleanup(app: &tauri::AppHandle) {
    logbus::line("host", "quitting");
    backend::stop(app);
    pidkill::backstop();
}
