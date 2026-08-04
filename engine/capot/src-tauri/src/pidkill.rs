// pidkill.rs — the last-resort cleanup on quit, for the case where the supervisor never got
// there (hung, or already crashed). An engine that survives the app holds the audio device
// and both ports. The pidfile is the contract both sides already agree on. See docs/tray.md.

use std::fs;
use std::process::Command;

use crate::paths::engine_pid_path;

/// Kill a process and its descendants, the same two mechanisms the supervisor uses (processTree.ts): Windows
/// has no signals, so `taskkill /T /F` walks the parent links; Unix signals the process GROUP, which every
/// engine leads (spawned detached), so negating the pid reaches everything it forked.
///
/// Shelling out rather than walking the process table is what lets the whole `sysinfo` crate go: this runs
/// once, at quit, and correctness here is about REACH, not about avoiding a spawn.
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW — the tray is windowless
            .status();
    }
    #[cfg(not(windows))]
    {
        // -pid is the group. `kill` rather than libc needs no extra dependency; a failure means it was already gone.
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .status();
    }
}

/// Kill whatever the pidfile names, tree and all, and remove it. A missing pidfile or dead pid is the normal case.
pub fn backstop() {
    let Ok(text) = fs::read_to_string(engine_pid_path()) else {
        return;
    };
    if let Ok(pid) = text.trim().parse::<u32>() {
        kill_tree(pid);
    }
    let _ = fs::remove_file(engine_pid_path());
}
