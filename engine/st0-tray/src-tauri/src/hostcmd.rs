// hostcmd.rs — where the supervisor (engine/st0-supervisor, a native program) lives, in three
// tiers: $STUDIO_ENGINE_HOST_CMD, the copy packaged beside this executable, or the repo's newest
// build. Says clearly when the answer is "nothing" — a tray that silently supervises nothing looks
// exactly like a healthy one. See docs/tray.md.

use std::path::PathBuf;
use std::time::SystemTime;

/// A resolved supervisor command: the program and its arguments.
pub struct HostCmd {
    pub program: PathBuf,
    pub args: Vec<PathBuf>,
}

const NAME: &str = if cfg!(windows) { "st0-supervisor.exe" } else { "st0-supervisor" };

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|p| p.to_path_buf())
}

/// The sidecar a packaged app carries: Tauri puts it beside the tray's own executable.
fn bundled() -> Option<HostCmd> {
    let program = exe_dir()?.join(NAME);
    program.is_file().then(|| HostCmd { program, args: Vec::new() })
}

/// The freshest build under engine/st0-supervisor/build, a Debug one only when nothing else is there.
fn from_repo() -> Option<HostCmd> {
    let build = crate::paths::repo_root()?.join("engine/st0-supervisor/build");
    let mut found: Vec<(bool, SystemTime, PathBuf)> = Vec::new();
    for preset in std::fs::read_dir(&build).ok()?.flatten() {
        for cfg in ["", "Release", "RelWithDebInfo", "Debug"] {
            let p = preset.path().join(cfg).join(NAME);
            if let Ok(meta) = std::fs::metadata(&p) {
                if meta.is_file() {
                    let at = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                    found.push((cfg == "Debug", at, p));
                }
            }
        }
    }
    // Release before Debug, then newest first.
    found.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    found.into_iter().next().map(|(_, _, program)| HostCmd { program, args: Vec::new() })
}

/// Resolve the supervisor command, or None — a hard failure host.rs turns into "⚠ supervisor not found",
/// rather than leaving a green icon over an empty stack.
pub fn resolve() -> Option<HostCmd> {
    if let Ok(cmd) = std::env::var("STUDIO_ENGINE_HOST_CMD") {
        let p = PathBuf::from(cmd);
        if p.is_file() {
            return Some(HostCmd { program: p, args: Vec::new() });
        }
    }
    bundled().or_else(from_repo)
}
