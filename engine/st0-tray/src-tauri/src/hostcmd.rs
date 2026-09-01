// hostcmd.rs — where the supervisor (@studio/engine-host) lives and how to run it, in
// three tiers: $STUDIO_ENGINE_HOST_CMD, the packaged node + engine-host.mjs, or the repo's
// tsx on the TypeScript source. Says clearly when the answer is "nothing" — a tray that
// silently supervises nothing looks exactly like a healthy one. See docs/tray.md.

use std::path::PathBuf;

/// A resolved supervisor command: the program and its arguments.
pub struct HostCmd {
    pub program: PathBuf,
    pub args: Vec<PathBuf>,
}

/// Trust the OS certificate store, not just Node's bundled Mozilla set. NOT a preference: a web UI added from
/// the tray is routinely behind a local proxy with a private CA, which exists in the OS store and nowhere else —
/// and without this the heartbeat fails the handshake SILENTLY (a registry merely down must not be an error),
/// so the engine never appears in that UI's picker. Node >= 22.15; an older dev `node` exits with `bad option`,
/// which the merged log shows verbatim. `NODE_EXTRA_CA_CERTS` keeps working alongside it.
const USE_SYSTEM_CA: &str = "--use-system-ca";

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|p| p.to_path_buf())
}

/// The vendored (node, engine-host.mjs) pair of a packaged app; probe both resource layouts rather than
/// depending on Tauri's exact one (the same list as the file service's, for the same reason).
fn bundled() -> Option<HostCmd> {
    let dir = exe_dir()?;
    let node = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    if !node.is_file() {
        return None;
    }
    let script = [
        dir.join("../Resources/engine-host.mjs"),
        dir.join("../Resources/resources/engine-host.mjs"),
        dir.join("engine-host.mjs"),
        dir.join("resources/engine-host.mjs"),
    ]
    .into_iter()
    .find(|p| p.is_file())?;
    Some(HostCmd {
        program: node,
        args: vec![PathBuf::from(USE_SYSTEM_CA), script],
    })
}

/// The repo's tsx CLI on the supervisor's source, under whatever `node` is on PATH — a dev machine has one.
fn from_repo() -> Option<HostCmd> {
    let root = crate::paths::repo_root()?;
    let tsx = root.join("node_modules/tsx/dist/cli.mjs");
    let entry = root.join("packages/engine-host/src/main.ts");
    if !tsx.is_file() || !entry.is_file() {
        return None;
    }
    Some(HostCmd {
        program: PathBuf::from("node"),
        args: vec![PathBuf::from(USE_SYSTEM_CA), tsx, entry],
    })
}

/// Resolve the supervisor command, or None — a hard failure host.rs turns into "⚠ supervisor not found",
/// rather than leaving a green icon over an empty stack.
pub fn resolve() -> Option<HostCmd> {
    if let Ok(cmd) = std::env::var("STUDIO_ENGINE_HOST_CMD") {
        let p = PathBuf::from(cmd);
        if p.is_file() {
            return Some(HostCmd {
                program: p,
                args: Vec::new(),
            });
        }
    }
    bundled().or_else(from_repo)
}
