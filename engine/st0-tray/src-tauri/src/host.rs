// host.rs — the NDJSON link to the supervisor: snapshots up its stdout, commands down its
// stdin. The structs here are a deliberately PARTIAL Rust mirror of hostProtocol.ts — only
// what the tray consumes. It is spawned into the kill-on-close job and relaunched with
// backoff if it crashes; the engine survives that via its pidfile. See docs/tray.md.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::hostcmd;
use crate::logbus;
use crate::tray;

/// Which staged subsystems the supervisor owns in this build. Mirrors HostOwnership.
#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Ownership {
    pub engine: bool,
    pub engine_queries: bool,
}

/// One audio interface the engine offered; the label reads `{name} [{device_type}]`. The engine calls this field
/// `type` on ITS wire, and the supervisor renames it on the way through.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioDevice {
    pub name: String,
    pub device_type: String,
    pub current: bool,
}

/// One INSTALLED plugin, for the settings window's list. The catalogue, not the instances `EditPlugin` names.
/// Serialize as well as Deserialize: the window draws these rows verbatim, so a second struct would only drift.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Plugin {
    pub name: String,
    pub format: String,
    pub manufacturer: String,
    /// "instrument" | "audioEffect" | "midiEffect", verbatim from the engine.
    pub role: String,
}

/// One plugin instance in one of the engine's projects, for the "Native plugin UI ▸" submenu.
/// showUI takes `session` and `id` together: the engine holds N projects, and the same module in
/// two of them is two rows. `default` covers a supervisor older than the field, whose rows are
/// all the default session.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditPlugin {
    pub session: String,
    pub id: String,
    pub name: String,
    /// False for built-ins: no native editor to open, so no clickable row.
    pub has_native_plugin_ui: bool,
}

/// One project the engine is holding, for the "Sessions" submenu.
///
/// The fact this whole submenu exists to surface: ONE engine now serves several apps, and
/// the status line said "Running · :8833" whether it held nothing or held a song, a deck
/// and a module preview at once.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub id: String,
    /// The loaded project's name; empty when the session holds nothing yet.
    pub project: String,
    pub loaded: bool,
    pub playing: bool,
    pub tracks: usize,
    /// Sockets subscribed to this session's audio — someone is LISTENING over the network.
    pub listeners: usize,
}

/// One st0 instance this engine is connected to, for the "st0 instances" tab — a registry it heartbeats to and
/// holds a tunnel with. Serialize as well: the window draws it verbatim.
#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Instance {
    pub url: String,
    /// False for a registry from `$STUDIO_REGISTRY_URL`: removing it here would not stick.
    pub removable: bool,
}

/// The last "add a st0 instance": its registry being asked, or the reason it said no. Drawn verbatim under the form.
#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InstanceCheck {
    /// The registry that was asked — pl8's, whatever was typed.
    pub url: String,
    /// "checking" | "refused".
    pub state: String,
    pub message: Option<String>,
}

/// The paths the tray opens directly — sent rather than recomputed, so `<state>` has one definition.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Paths {
    pub root: String,
    pub merged_log: String,
}

/// An instrument the supervisor is fetching for the engine — the menu's one transient line while it runs.
#[derive(Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Download {
    pub name: String,
    pub label: String,
    pub received: u64,
    pub total: u64,
    /// "downloading" | "unpacking" | "failed"
    pub phase: String,
    pub error: Option<String>,
}

/// The supervisor's view of the world, as far as the tray consumes it.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Snapshot {
    pub owns: Ownership,
    /// "stopped" | "running" | "error" — the supervisor's word on the engine.
    pub status: String,
    /// Set when `status` is "error"; shown verbatim on the status line.
    pub error: Option<String>,
    /// True only when the SUPERVISOR spawned the running engine; a foreign one greys out Stop and Restart.
    pub owns_engine: bool,
    pub user_stopped: bool,
    pub engine_id: String,
    pub engine_port: u16,
    pub registry_url: String,
    pub last_heartbeat_ok: bool,
    /// None means "the engine hasn't answered yet" — the spinner, not "none found".
    pub plugin_count: Option<usize>,
    /// The installed catalogue, name-sorted, drawn only by the settings window.
    pub plugins: Vec<Plugin>,
    /// Changes exactly when that catalogue does, so only a rescan redraws the list.
    pub plugins_sig: String,
    pub audio_devices: Vec<AudioDevice>,
    /// The interfaces the user RANKED, best first. The first one PRESENT is where the engine
    /// goes; a name with nothing behind it is unplugged and keeps its rank, so replugging restores it.
    pub audio_priority: Vec<String>,
    /// Changes exactly when the audio submenu's CONTENT would: the tray rebuilds on a difference, never recomputes.
    pub audio_menu_sig: String,
    pub edit_plugins: Vec<EditPlugin>,
    /// The same trick for "Native plugin UI ▸": the ids of the openable plugins.
    pub edit_plugins_sig: String,
    pub sessions: Vec<Session>,
    /// The same trick again for "Sessions": what the rows SHOW, so a moving playhead does
    /// not tear down a submenu the user has open.
    pub sessions_sig: String,
    /// The st0 instances this engine is connected to — empty on a fresh machine, which assumes none.
    pub instances: Vec<Instance>,
    /// An add in flight or just refused; None once one succeeds.
    pub instance_check: Option<InstanceCheck>,
    pub paths: Paths,
    /// Instruments being fetched; empty, and absent from the frame, once every one is here.
    pub downloads: Vec<Download>,
}

// Before the first snapshot the menu must still draw something; these are settings.ts's own defaults, so an
// early frame can't show ports contradicting what the supervisor is about to report.
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            owns: Ownership::default(),
            status: "stopped".to_string(),
            error: None,
            owns_engine: false,
            user_stopped: false,
            engine_id: String::new(),
            engine_port: 8765,
            registry_url: String::new(),
            last_heartbeat_ok: false,
            plugin_count: None,
            plugins: Vec::new(),
            plugins_sig: String::new(),
            audio_devices: Vec::new(),
            audio_priority: Vec::new(),
            audio_menu_sig: String::new(),
            edit_plugins: Vec::new(),
            edit_plugins_sig: String::new(),
            sessions: Vec::new(),
            sessions_sig: String::new(),
            downloads: Vec::new(),
            instances: Vec::new(),
            instance_check: None,
            paths: Paths::default(),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
enum Event {
    State(Box<Snapshot>),
    Notify {
        kind: String,
        title: String,
        body: String,
    },
    Result {
        #[allow(dead_code)]
        id: u64,
        ok: bool,
        #[serde(default)]
        message: Option<String>,
    },
}

/// The channel's write half plus the child we can wait on, in its own mutex and NOT in AppState: a send must
/// never queue behind the state lock, and an arriving snapshot must never queue behind a send.
pub struct HostLink {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    next_id: AtomicU64,
    /// Set by shutdown_and_wait, so the relaunch loop knows an exit was intended.
    stopping: AtomicBool,
}

impl HostLink {
    fn new() -> Self {
        Self {
            stdin: Mutex::new(None),
            child: Mutex::new(None),
            next_id: AtomicU64::new(1),
            stopping: AtomicBool::new(false),
        }
    }
}

/// Start the supervisor and keep it running; returns at once, the relaunch loop living on its own thread.
pub fn spawn(app: &AppHandle) {
    app.manage(Arc::new(HostLink::new()));
    let app = app.clone();
    std::thread::spawn(move || run_forever(app));
}

fn run_forever(app: AppHandle) {
    let Some(cmd) = hostcmd::resolve() else {
        // Not retried — resolution is static, so a second attempt fails identically. LOUD on purpose: a tray
        // supervising nothing looks exactly like a healthy one from the menu bar.
        logbus::line("host", "supervisor not found (no bundled st0-supervisor, no repo build)");
        tray::set_host_error(&app, Some("supervisor not found".into()));
        return;
    };
    let mut backoff = 1u64;
    loop {
        let started = Instant::now();
        logbus::line(
            "host",
            &format!("starting supervisor: {}", cmd.program.display()),
        );
        if let Err(e) = launch(&app, &cmd) {
            logbus::line("host", &format!("could not start supervisor: {e}"));
            tray::set_host_error(&app, Some(format!("supervisor won't start: {e}")));
        }
        let link = app.state::<Arc<HostLink>>();
        if link.stopping.load(Ordering::SeqCst) {
            return; // we asked it to go
        }
        // One that ran a while and died is a one-off; one that dies immediately is broken and would bury the log.
        // Reset the backoff only on the former.
        if started.elapsed() > Duration::from_secs(20) {
            backoff = 1;
        }
        tray::set_host_error(&app, Some("supervisor restarting…".into()));
        std::thread::sleep(Duration::from_secs(backoff));
        backoff = (backoff * 2).min(30);
    }
}

/// How long a quiet link goes before the supervisor's own process is asked whether it is still there.
const SUPERVISOR_POLL: Duration = Duration::from_secs(1);

/// Has the supervisor exited? Asked of the PROCESS, never of its pipe, which a surviving grandchild can
/// hold open for good. Already reaped — `None` — counts as gone, since only a teardown takes it.
fn supervisor_gone(app: &AppHandle) -> bool {
    let link = app.state::<Arc<HostLink>>();
    let mut child = link.child.lock().unwrap();
    match child.as_mut() {
        Some(c) => matches!(c.try_wait(), Ok(Some(_))),
        None => true,
    }
}

/// Run one supervisor to completion, returning its exit code once the link is done or the process is gone.
fn launch(app: &AppHandle, cmd: &hostcmd::HostCmd) -> std::io::Result<Option<i32>> {
    let mut command = Command::new(&cmd.program);
    command
        .args(&cmd.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // No console window: the supervisor is a console program and the tray is windowless, so Windows would pop a terminal.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;

    // The ONLY assign call now: the supervisor starts the rest, and a job member's children join the job.
    crate::job::assign(&child);

    // The supervisor's diagnostics go to stderr — stdout is the protocol — so they belong in the merged log.
    if let Some(err) = child.stderr.take() {
        logbus::pump(err, "host");
    }
    let stdout = child.stdout.take().expect("piped stdout");
    {
        let link = app.state::<Arc<HostLink>>();
        *link.stdin.lock().unwrap() = child.stdin.take();
    }
    let pid = child.id();
    {
        let link = app.state::<Arc<HostLink>>();
        *link.child.lock().unwrap() = Some(child);
    }
    logbus::line("host", &format!("supervisor up (pid {pid})"));

    // Frames come over a channel so that a silent link can be checked against the process itself:
    // EOF is not proof of death, and its absence is not proof of life (docs/tray.md).
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if tx.send(std::mem::take(&mut line)).is_err() {
                break; // nobody is listening any more: this launch is over
            }
        }
    });

    loop {
        let line = match rx.recv_timeout(SUPERVISOR_POLL) {
            Ok(line) => line,
            Err(RecvTimeoutError::Disconnected) => break, // the pipe closed: the ordinary way we learn
            Err(RecvTimeoutError::Timeout) => {
                if supervisor_gone(app) {
                    // The reader thread stays parked on a pipe only the orphan can close; say so and move on.
                    logbus::line("host", "supervisor is gone, its stdout still held open by a survivor");
                    break;
                }
                continue;
            }
        };
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        match serde_json::from_str::<Event>(text) {
            Ok(Event::State(snapshot)) => tray::apply_snapshot(app, *snapshot),
            Ok(Event::Notify { kind, title, body }) => {
                if kind == "modal" {
                    tray::notify_modal(&title, &body);
                } else {
                    tray::notify_passive(app, &title, &body);
                }
            }
            Ok(Event::Result { ok, message, .. }) => {
                if !ok {
                    let msg = message.unwrap_or_else(|| "command failed".into());
                    logbus::line("host", &format!("command failed: {msg}"));
                }
            }
            // Not fatal: an unreadable frame is a protocol bug worth seeing, but dropping the channel would take the
            // app down over a typo.
            Err(e) => logbus::line("host", &format!("unreadable frame ({e}): {text}")),
        }
    }

    // Reap, so a dead supervisor doesn't linger as a zombie, and read the code a dev reload identifies itself by.
    let link = app.state::<Arc<HostLink>>();
    *link.stdin.lock().unwrap() = None;
    let code = link
        .child
        .lock()
        .unwrap()
        .take()
        .and_then(|mut c| c.wait().ok())
        .and_then(|s| s.code());
    match code {
        Some(c) => logbus::line("host", &format!("supervisor exited ({c})")),
        None => logbus::line("host", "supervisor exited"),
    }
    Ok(code)
}

/// Send a command, fire-and-forget: a reply arrives as a `result` frame and is surfaced only on failure.
/// A no-op while the supervisor is down — the relaunch loop fixes that, not the caller.
pub fn send(app: &AppHandle, cmd: &str, arg: Option<&str>) {
    let link = app.state::<Arc<HostLink>>();
    let id = link.next_id.fetch_add(1, Ordering::SeqCst);
    let payload = match arg {
        Some(a) => serde_json::json!({ "t": "cmd", "id": id, "cmd": cmd, "arg": a }),
        None => serde_json::json!({ "t": "cmd", "id": id, "cmd": cmd }),
    };
    let mut guard = link.stdin.lock().unwrap();
    let Some(stdin) = guard.as_mut() else {
        logbus::line("host", &format!("dropped `{cmd}` — supervisor is down"));
        return;
    };
    // A failed write means the pipe broke: drop our end, so the next send says "supervisor is down".
    if writeln!(stdin, "{payload}").and_then(|_| stdin.flush()).is_err() {
        logbus::line("host", &format!("lost the pipe while sending `{cmd}`"));
        *guard = None;
    }
}

/// Ask the supervisor to shut down and wait briefly, BEFORE the tray tears down anything of its own: it
/// deregisters on its way out, which wants to happen while the engine is still up. Bounded, then killed —
/// one stuck on an unresponsive registry must not hold the app open, and the backstop cleans up after it.
pub fn shutdown_and_wait(app: &AppHandle) {
    let link = app.state::<Arc<HostLink>>();
    link.stopping.store(true, Ordering::SeqCst);
    send(app, "shutdown", None);
    // Dropping stdin is the Unix teardown signal, and makes a supervisor that ignored the command exit anyway.
    *link.stdin.lock().unwrap() = None;

    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let mut guard = link.child.lock().unwrap();
        let Some(child) = guard.as_mut() else { return }; // already reaped by the reader
        match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                return;
            }
            Err(_) => {
                *guard = None;
                return;
            }
            Ok(None) => {}
        }
        if Instant::now() >= deadline {
            // The supervisor itself only, a plain kill: it is our direct child and NOT a group leader, so signalling a
            // group would reach the tray's own. What it left running is the engine, which the backstop reaches.
            let _ = child.kill();
            let _ = child.wait();
            *guard = None;
            return;
        }
        drop(guard); // never sleep holding a lock the reader thread needs
        std::thread::sleep(Duration::from_millis(50));
    }
}
