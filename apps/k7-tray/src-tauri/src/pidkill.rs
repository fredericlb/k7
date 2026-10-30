// pidkill.rs — the last-resort cleanup on quit, for the case where the supervisor never got
// there (hung, or already crashed). An engine that survives the app holds the audio device
// and both ports. The pidfile is the contract both sides already agree on: a pid line, then
// `start=` and `exe=` (engine/k7-supervisor/src/PidFile.cpp). Only a process proved to be that
// engine is killed — the OS may have given the number to anything since. See docs/tray.md.

use std::fs;
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

use crate::paths::engine_pid_path;

/// The pidfile's identity, or what the OS says of a live pid now.
#[derive(Debug, Clone, PartialEq)]
struct Record {
    pid: u32,
    start: Option<String>,
    exe: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Check {
    /// The very process the file names: the one case that may be killed.
    Same,
    /// Alive, but nothing proves it is the engine: left alone, and so is the file.
    Unverified,
    /// Gone, or a process that is not the engine: the file is out of date.
    Stale,
}

/// The pid on the first line, `start=` and `exe=` after it; `None` when the first line is not a pid.
fn parse(text: &str) -> Option<Record> {
    let mut lines = text.lines();
    let head = lines.next()?.trim();
    if head.is_empty() || head.len() > 9 || !head.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let pid: u32 = head.parse().ok().filter(|&p| p > 0)?;
    let mut rec = Record { pid, start: None, exe: None };
    for line in lines.map(str::trim) {
        if let Some(s) = line.strip_prefix("start=") {
            if !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit()) {
                rec.start = Some(s.to_string());
            }
        } else if let Some(e) = line.strip_prefix("exe=") {
            rec.exe = Some(e.to_string());
        }
    }
    Some(rec)
}

fn is_engine_exe(exe: &str) -> bool {
    let name = exe.rsplit(['/', '\\']).next().unwrap_or(exe).to_ascii_lowercase();
    name == "k7-runtime" || name == "k7-runtime.exe"
}

/// The same verdict as PidFile.cpp's `check` and supervisor-host's `checkPid`.
fn check(recorded: &Record, live: Option<&Record>, alive: bool) -> Check {
    if !alive {
        return Check::Stale;
    }
    let Some((Some(start), Some(exe))) = live.map(|l| (l.start.as_ref(), l.exe.as_ref())) else {
        return Check::Unverified;
    };
    // Whatever the file says, a live process that is not the engine is never ours to kill.
    if !is_engine_exe(exe) {
        return Check::Stale;
    }
    match &recorded.start {
        None => Check::Unverified,
        Some(s) if s == start => Check::Same,
        Some(_) => Check::Stale,
    }
}

/// The output of a short command, or `None` when it fails; never a console window on Windows.
fn output(bin: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args).env("LC_ALL", "C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — the tray is windowless
    }
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
fn system32(file: &str) -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    format!("{root}\\System32\\{file}")
}

/// `ps -o lstart=` in the C locale, as local seconds since the epoch: what macOS's pbi_start_tvsec holds.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn lstart_seconds(text: &str) -> Option<String> {
    use chrono::{Local, NaiveDateTime, TimeZone};
    let words = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let naive = NaiveDateTime::parse_from_str(&words, "%a %b %d %H:%M:%S %Y").ok()?;
    let at = Local.from_local_datetime(&naive).earliest()?;
    Some(at.timestamp().to_string())
}

/// What the OS says of `pid` now: its start time as PidFile.cpp spells it, and its executable.
fn inspect(pid: u32) -> Option<Record> {
    #[cfg(target_os = "linux")]
    {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let after = &stat[stat.rfind(')')? + 1..];
        let start = after.split_whitespace().nth(19)?.to_string();
        let exe = fs::read_link(format!("/proc/{pid}/exe")).ok()?;
        let exe = exe.to_string_lossy().trim_end_matches(" (deleted)").to_string();
        Some(Record { pid, start: Some(start), exe: Some(exe) })
    }
    #[cfg(target_os = "macos")]
    {
        let p = pid.to_string();
        let start = lstart_seconds(&output("/bin/ps", &["-o", "lstart=", "-p", &p])?)?;
        let exe = output("/bin/ps", &["-o", "comm=", "-p", &p])?.trim().to_string();
        Some(Record { pid, start: Some(start), exe: Some(exe) })
    }
    #[cfg(windows)]
    {
        let ps = system32("WindowsPowerShell\\v1.0\\powershell.exe");
        let script = format!(
            "$p = Get-Process -Id {pid} -ErrorAction Stop; $p.StartTime.ToFileTimeUtc(); $p.Path"
        );
        let text = output(&ps, &["-NoProfile", "-NonInteractive", "-Command", &script])?;
        let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
        let start = lines.next()?.to_string();
        let exe = lines.next()?.to_string();
        Some(Record { pid, start: Some(start), exe: Some(exe) })
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = pid;
        None
    }
}

/// Whether any process bears `pid`, whoever owns it.
fn alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let filter = format!("PID eq {pid}");
        output(&system32("tasklist.exe"), &["/FI", &filter, "/NH", "/FO", "CSV"])
            .is_some_and(|out| out.contains(&format!("\"{pid}\"")))
    }
    #[cfg(not(windows))]
    {
        // `ps -p` answers for another user's process too, where `kill -0` would be refused.
        output("/bin/ps", &["-o", "pid=", "-p", &pid.to_string()]).is_some_and(|o| !o.trim().is_empty())
    }
}

/// Kill a process and its descendants, the same two mechanisms the supervisor uses (processTree.ts): Windows
/// has no signals, so `taskkill /T /F` walks the parent links; Unix signals the process GROUP, which every
/// engine leads (spawned detached), so negating the pid reaches everything it forked.
///
/// Shelling out rather than walking the process table is what lets the whole `sysinfo` crate go: this runs
/// once, at quit, and correctness here is about REACH, not about avoiding a spawn.
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let p = pid.to_string();
        let _ = output(&system32("taskkill.exe"), &["/PID", &p, "/T", "/F"]);
    }
    #[cfg(not(windows))]
    {
        let p = pid.to_string();
        // The group only when the pid leads it: a negative pid names whichever group bears that number.
        let leads = output("/bin/ps", &["-o", "pgid=", "-p", &p]).is_some_and(|g| g.trim() == p);
        let target = if leads { format!("-{p}") } else { p };
        let _ = Command::new("kill").args(["-KILL", &target]).status();
    }
}

/// Kill the engine the pidfile names, once proved to be it; the file stays while its process may live (docs/tray.md).
pub fn backstop() {
    let path = engine_pid_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    let Some(recorded) = parse(&text) else {
        let _ = fs::remove_file(&path);
        return;
    };
    let live = alive(recorded.pid);
    match check(&recorded, inspect(recorded.pid).as_ref(), live) {
        Check::Stale => {
            let _ = fs::remove_file(&path);
        }
        Check::Unverified => {
            crate::logbus::line("host", &format!("pid {} may not be the engine — left alone", recorded.pid));
        }
        Check::Same => {
            crate::logbus::line("host", &format!("engine {} outlived the backend — killed", recorded.pid));
            kill_tree(recorded.pid);
            for _ in 0..20 {
                if !alive(recorded.pid) {
                    let _ = fs::remove_file(&path);
                    return;
                }
                sleep(Duration::from_millis(100));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(pid: u32, start: Option<&str>, exe: Option<&str>) -> Record {
        Record { pid, start: start.map(String::from), exe: exe.map(String::from) }
    }

    #[test]
    fn the_supervisor_format_parses_by_its_first_line() {
        let r = parse("4242\nstart=123456\nexe=/opt/k7/k7-runtime\nport=8766\n").unwrap();
        assert_eq!(r, rec(4242, Some("123456"), Some("/opt/k7/k7-runtime")));
        assert_eq!(parse("4242\r\n").unwrap(), rec(4242, None, None));
        assert!(parse("start=1\n").is_none());
        assert!(parse("0\n").is_none());
        assert!(parse("").is_none());
    }

    #[test]
    fn only_the_same_engine_may_be_killed() {
        let file = rec(7, Some("100"), Some("k7-runtime"));
        let same = rec(7, Some("100"), Some("C:\\k7\\K7-RUNTIME.EXE"));
        assert_eq!(check(&file, Some(&same), true), Check::Same);
        assert_eq!(check(&file, Some(&same), false), Check::Stale);
        assert_eq!(check(&file, Some(&rec(7, Some("200"), Some("k7-runtime"))), true), Check::Stale);
        assert_eq!(check(&file, Some(&rec(7, Some("100"), Some("/usr/bin/vim"))), true), Check::Stale);
        assert_eq!(check(&file, None, true), Check::Unverified);
        assert_eq!(check(&rec(7, None, None), Some(&same), true), Check::Unverified);
    }

    #[test]
    fn lstart_reads_as_local_seconds() {
        let a = lstart_seconds("Sat Oct 31 00:12:05 2026").unwrap();
        let b = lstart_seconds("Sat  Oct  31  00:12:06  2026\n").unwrap();
        assert_eq!(b.parse::<i64>().unwrap() - a.parse::<i64>().unwrap(), 1);
        assert!(lstart_seconds("not a date").is_none());
    }
}
