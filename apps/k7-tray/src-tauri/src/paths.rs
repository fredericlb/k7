// paths.rs — where the tray finds what it starts (node, k7's backend bundle, the supervisor) and where state lives.
// Packaged, everything is in the bundle's resources (scripts/stage.mjs); in a checkout, the staged copy under
// src-tauri/resources, or the repo's own builds. `~/.k7` mirrors studioHome.ts BY HAND. See docs/tray.md.

use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

const fn exe(name: &'static str, windows: &'static str) -> &'static str {
    if cfg!(windows) {
        windows
    } else {
        name
    }
}
const SUPERVISOR: &str = exe("k7-supervisor", "k7-supervisor.exe");
const ENGINE: &str = exe("k7-runtime", "k7-runtime.exe");
const NODE: &str = exe("node", "node.exe");

/// `<state>` — the machine's engine home, the command-line engine's too: `$STUDIO_HOME`, else `~/.k7`.
pub fn studio_dir() -> PathBuf {
    match std::env::var("STUDIO_HOME") {
        Ok(h) if !h.is_empty() => PathBuf::from(h),
        _ => dirs::home_dir().expect("no home directory").join(".k7"),
    }
}

/// The running engine's pid: the backstop's way to reach an orphan.
pub fn engine_pid_path() -> PathBuf {
    studio_dir().join("engine.pid")
}

/// The merged log: the supervisor's and the engine's lines, the backend's under `[backend]`, the tray's under `[host]`.
pub fn merged_log_path() -> PathBuf {
    studio_dir().join(".studio.log")
}

/// The backend's own state (workspaces, media library, prefs): the OS's per-app folder, never `~/.k7`.
pub fn backend_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| studio_dir().join("local-backend"))
}

/// Where node keeps the bytecode it compiled of the bundle: the OS's per-app cache, which it may clear.
pub fn node_compile_cache(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("node-compile-cache"))
}

/// The staged resources: the bundle's when packaged, `src-tauri/resources` in a checkout.
fn resources(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        if dir.join("backend").is_dir() {
            return dir;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
}

/// k7's backend bundle (apps/k7/backend/scripts/bundle.mjs): `$K7_BACKEND_BUNDLE`, else the staged one.
pub fn backend_bundle(app: &AppHandle) -> Option<PathBuf> {
    let dir = std::env::var("K7_BACKEND_BUNDLE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| resources(app).join("backend"));
    dir.join("bin").join("backend.mjs").is_file().then_some(dir)
}

/// The node the bundle runs on: the staged one, else `$K7_NODE`, else whatever `node` the PATH has.
pub fn node(app: &AppHandle) -> PathBuf {
    let staged = resources(app).join("node").join(NODE);
    if staged.is_file() {
        return staged;
    }
    std::env::var("K7_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(NODE))
}

/// The backend's table of ports, environment and folders, shared with the phone (apps/k7/backend/standalone.json).
pub fn standalone_json(app: &AppHandle) -> Option<PathBuf> {
    let staged = resources(app).join("standalone.json");
    if staged.is_file() {
        return Some(staged);
    }
    let repo = repo_root()?.join("apps/k7/backend/standalone.json");
    repo.is_file().then_some(repo)
}

/// The supervisor: `$STUDIO_ENGINE_HOST_CMD`, the staged copy, or the repo's newest build; None is a loud failure.
pub fn supervisor(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(cmd) = std::env::var("STUDIO_ENGINE_HOST_CMD") {
        let p = PathBuf::from(cmd);
        if p.is_file() {
            return Some(p);
        }
    }
    let staged = resources(app).join("bin").join(SUPERVISOR);
    if staged.is_file() {
        return Some(staged);
    }
    newest_build("k7-supervisor", SUPERVISOR)
}

/// The engine binary beside the supervisor, for the backend's offline renders (`$STUDIO_ENGINE`).
pub fn engine_beside(supervisor: &Path) -> Option<PathBuf> {
    let beside = supervisor.parent()?.join(ENGINE);
    if beside.is_file() {
        return Some(beside);
    }
    newest_build("k7-runtime", ENGINE)
}

/// The monorepo root of a checkout run: `$STUDIO_REPO_ROOT`, else up from this crate to the dir holding `engine/k7-runtime`.
fn repo_root() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("STUDIO_REPO_ROOT") {
        let p = PathBuf::from(root);
        if p.is_dir() {
            return Some(p);
        }
    }
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if dir.join("engine/k7-runtime").is_dir() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

/// The freshest build of a CMake target under `engine/<project>/build/<preset>/[<config>/]`, Debug last; never a phone's.
fn newest_build(project: &str, name: &str) -> Option<PathBuf> {
    let build = repo_root()?.join("engine").join(project).join("build");
    let mut found: Vec<(bool, SystemTime, PathBuf)> = Vec::new();
    for preset in std::fs::read_dir(&build).ok()?.flatten() {
        let preset_name = preset.file_name().to_string_lossy().into_owned();
        if preset_name.starts_with("android-") || preset_name.starts_with("ios-") {
            continue;
        }
        for cfg in ["", "Release", "RelWithDebInfo", "Debug"] {
            let p = preset.path().join(cfg).join(name);
            if let Ok(meta) = std::fs::metadata(&p) {
                if meta.is_file() {
                    let at = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                    found.push((cfg == "Debug", at, p));
                }
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    found.into_iter().next().map(|(_, _, p)| p)
}
