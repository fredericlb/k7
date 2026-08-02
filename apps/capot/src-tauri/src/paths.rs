// paths.rs — the few `~/.lanes/` paths the tray still touches itself. The LAYOUT lives
// in packages/engine-host/src/paths.ts, and the paths the tray opens for the user arrive in
// the supervisor's snapshot. What is left belongs to subsystems not handed over yet.

use std::path::PathBuf;

/// `~/.lanes` — the shared state dir. Panics only if there is no home dir.
pub fn lanes_dir() -> PathBuf {
    dirs::home_dir()
        .expect("no home directory")
        .join(".lanes")
}

/// The running engine's pid: the one-engine-per-machine guard, and the backstop's way to reach an orphan.
pub fn engine_pid_path() -> PathBuf {
    lanes_dir().join("engine.pid")
}

/// The MERGED log the tray writes: engine and file service, interleaved and tagged. logbus needs the path
/// directly to open the file; "Show logs" uses the copy that comes down in the snapshot.
pub fn merged_log_path() -> PathBuf {
    lanes_dir().join(".lanes.log")
}

/// The monorepo root, for locating dev builds: `$LANES_REPO_ROOT`, else walk up from the manifest dir
/// until a directory containing `apps/moteur` appears.
pub fn repo_root() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("LANES_REPO_ROOT") {
        let p = PathBuf::from(root);
        if p.is_dir() {
            return Some(p);
        }
    }
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // .../capot/src-tauri
    loop {
        if dir.join("apps/moteur").is_dir() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}
