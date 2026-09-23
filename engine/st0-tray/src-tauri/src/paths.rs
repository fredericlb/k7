// paths.rs — the few `<state>` paths the tray still touches itself. The LAYOUT lives in
// packages/engine-client/src/paths.ts, and the paths the tray opens for the user arrive in the
// supervisor's snapshot. What is left belongs to subsystems not handed over yet.
// Mirrors studioHome.ts BY HAND: two spellings of this directory is a tray writing a pidfile
// the supervisor never reads. See packages/engine-client/docs/paths.md.

use std::path::PathBuf;

/// `<state>` — the shared state dir, the same one the supervisor uses. `$STUDIO_HOME` first,
/// as in every other spelling of it (packages/engine-client/docs/paths.md).
pub fn studio_dir() -> PathBuf {
    match std::env::var("STUDIO_HOME") {
        Ok(h) if !h.is_empty() => PathBuf::from(h),
        // The home directory on every platform, because THREE languages compute this path and
        // each one's idea of "application data" differs — see engine-client/docs/paths.md.
        _ => dirs::home_dir().expect("no home directory").join(".st0"),
    }
}

/// The running engine's pid: the one-engine-per-machine guard, and the backstop's way to reach an orphan.
pub fn engine_pid_path() -> PathBuf {
    studio_dir().join("engine.pid")
}

/// The MERGED log the tray writes: engine and file service, interleaved and tagged. logbus needs the path
/// directly to open the file; "Show logs" uses the copy that comes down in the snapshot.
pub fn merged_log_path() -> PathBuf {
    studio_dir().join(".studio.log")
}

/// The monorepo root, for locating dev builds: `$STUDIO_REPO_ROOT`, else walk up from the manifest dir
/// until a directory containing `engine/st0-engine` appears.
pub fn repo_root() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("STUDIO_REPO_ROOT") {
        let p = PathBuf::from(root);
        if p.is_dir() {
            return Some(p);
        }
    }
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // .../capot/src-tauri
    loop {
        if dir.join("engine/st0-engine").is_dir() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}
