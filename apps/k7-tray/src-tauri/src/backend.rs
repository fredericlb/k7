// backend.rs — the one process the tray starts: node running k7's backend bundle on 127.0.0.1, which runs the
// machine's supervisor and so its engine. Spawned into the kill-on-close job, kept running with a backoff, stopped
// by closing its stdin (the stop Windows has no signal for). Its environment is standalone.json's. See docs/tray.md.

use std::io::Write;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::state::{Backend, SharedState};
use crate::{http, job, logbus, paths, tray};

/// The child and its stdin, kept so a stop can close the pipe and then make sure.
#[derive(Default)]
pub struct Process {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    stopping: AtomicBool,
}

/// What a backend needs from standalone.json: its fixed port, its environment, and its folders under the state root.
#[derive(serde::Deserialize)]
struct Table {
    port: u16,
    env: std::collections::BTreeMap<String, String>,
    dirs: std::collections::BTreeMap<String, String>,
}

/// How long a stop waits for the backend to stop its supervisor and itself before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(15);
/// A run this long was a healthy one: the next crash starts the backoff over.
const HEALTHY: Duration = Duration::from_secs(60);

fn set(app: &AppHandle, b: Backend) {
    app.state::<SharedState>().lock().unwrap().backend = b;
    tray::refresh(app);
}

/// The session secret, kept beside the backend's state so sessions outlive a restart; created once.
fn session_secret(root: &Path) -> String {
    let at = root.join("session-secret");
    if let Ok(s) = std::fs::read_to_string(&at) {
        if !s.trim().is_empty() {
            return s.trim().to_string();
        }
    }
    let s = random_hex(32);
    let _ = std::fs::write(&at, &s);
    s
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("no OS randomness");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// The table, read once: its port is also where the page lives.
pub fn port(app: &AppHandle) -> u16 {
    read_table(app).map(|t| t.port).unwrap_or(18789)
}

fn read_table(app: &AppHandle) -> Option<Table> {
    let file = paths::standalone_json(app)?;
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

/// The command, or why there is none — every miss is said on the status line, never a silent empty tray.
fn command(app: &AppHandle, token: &str) -> Result<Command, String> {
    let bundle = paths::backend_bundle(app).ok_or("k7's backend is missing from this install")?;
    let table = read_table(app).ok_or("standalone.json is missing from this install")?;
    let supervisor = paths::supervisor(app).ok_or("the engine's supervisor is missing from this install")?;
    let root = paths::backend_root(app);
    std::fs::create_dir_all(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;

    let mut c = Command::new(paths::node(app));
    c.arg(bundle.join("bin").join("backend.mjs"))
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("NODE_OPTIONS")
        .env_remove("TRUSTED_ORIGINS")
        .envs(&table.env);
    for (k, rel) in &table.dirs {
        c.env(k, root.join(rel));
    }
    c.env("PORT", table.port.to_string())
        .env("STUDIO_PORTS", format!("k7={}", table.port))
        .env("SESSION_SECRET", session_secret(&root))
        .env("STUDIO_FILE_SERVICE_ENTRY", bundle.join("bin").join("file-service.mjs"))
        .env("K7_SUPERVISOR_BIN", &supervisor)
        .env("K7_SUPERVISOR_HOME", paths::studio_dir())
        .env("K7_TRAY_TOKEN", token)
        .env("K7_RELEASE", env!("K7_RELEASE"))
        .env("K7_STDIN_STOP", "1");
    let seed = bundle.join("k7-core");
    if seed.is_dir() {
        c.env("STUDIO_LIBRARY_SEED", format!("k7-core={}", seed.display()));
    }
    if let Some(engine) = paths::engine_beside(&supervisor) {
        c.env("STUDIO_ENGINE", engine);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: the tray is windowless
    }
    Ok(c)
}

/// Start the backend and keep it running until the tray stops it.
pub fn spawn(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || run_forever(app));
}

fn run_forever(app: AppHandle) {
    let token = app.state::<SharedState>().lock().unwrap().token.clone();
    let port = app.state::<SharedState>().lock().unwrap().port;
    // An answer already there is another k7 on our port: the page would open on it, and our backend could not listen.
    if http::get(port, "/", None).is_some() {
        logbus::line("host", &format!("127.0.0.1:{port} is already in use"));
        return set(&app, Backend::Down(format!("port {port} is in use by another program")));
    }
    let mut delay = Duration::from_secs(2);
    let mut quick = 0;
    loop {
        let proc = app.state::<Process>();
        if proc.stopping.load(Ordering::SeqCst) {
            return;
        }
        set(&app, Backend::Starting);
        let started = Instant::now();
        let exit = match command(&app, &token).and_then(|mut c| c.spawn().map_err(|e| e.to_string())) {
            Ok(mut child) => {
                job::assign(&child);
                if let Some(out) = child.stdout.take() {
                    logbus::pump(out, "backend");
                }
                if let Some(err) = child.stderr.take() {
                    logbus::pump(err, "backend");
                }
                *proc.stdin.lock().unwrap() = child.stdin.take();
                *proc.child.lock().unwrap() = Some(child);
                logbus::line("host", "backend started");
                watch_ready(&app, port);
                wait(&proc)
            }
            Err(why) => {
                logbus::line("host", &format!("backend not started: {why}"));
                return set(&app, Backend::Down(why));
            }
        };
        if proc.stopping.load(Ordering::SeqCst) {
            return;
        }
        logbus::line("host", &format!("backend exited ({exit})"));
        if started.elapsed() >= HEALTHY {
            delay = Duration::from_secs(2);
            quick = 0;
        } else {
            quick += 1;
        }
        // Six quick deaths in a row is a backend that cannot start: say so and stop trying, the log says why.
        if quick >= 6 {
            return set(&app, Backend::Down(format!("k7 keeps stopping ({exit}) — see the logs")));
        }
        set(&app, Backend::Down(format!("k7 stopped ({exit}), restarting…")));
        std::thread::sleep(delay);
        delay = (delay * 2).min(Duration::from_secs(60));
    }
}

/// Block until the child exits; the description of how.
fn wait(proc: &Process) -> String {
    loop {
        if let Some(child) = proc.child.lock().unwrap().as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => return status.to_string(),
                Ok(None) => {}
                Err(e) => return e.to_string(),
            }
        } else {
            return "gone".into();
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Ready once the registry answers, the phone's probe too; the backend listens only once its library is in place.
fn watch_ready(app: &AppHandle, port: u16) {
    let app = app.clone();
    std::thread::spawn(move || {
        let until = Instant::now() + Duration::from_secs(90);
        while Instant::now() < until {
            if app.state::<Process>().stopping.load(Ordering::SeqCst) {
                return;
            }
            if let Some((200, _)) = http::get(port, "/api/registry/hello", None) {
                logbus::line("host", &format!("k7 answers on http://127.0.0.1:{port}"));
                return set(&app, Backend::Ready);
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    });
}

/// Stop the backend: close its stdin, which stops its supervisor and then itself; kill it past the grace.
pub fn stop(app: &AppHandle) {
    let proc = app.state::<Process>();
    proc.stopping.store(true, Ordering::SeqCst);
    if let Some(mut stdin) = proc.stdin.lock().unwrap().take() {
        let _ = stdin.flush();
    } // dropped here: the pipe closes
    let until = Instant::now() + STOP_GRACE;
    loop {
        let mut guard = proc.child.lock().unwrap();
        let Some(child) = guard.as_mut() else { return };
        if matches!(child.try_wait(), Ok(Some(_))) {
            *guard = None;
            return;
        }
        if Instant::now() >= until {
            logbus::line("host", "backend did not stop in time — killed");
            let _ = child.kill();
            *guard = None;
            return;
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The address the menu opens: the backend's root, or one of its pages.
pub fn url(app: &AppHandle, path: &str) -> String {
    let port = app.state::<SharedState>().lock().unwrap().port;
    format!("http://127.0.0.1:{port}{path}")
}
