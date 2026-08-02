// logbus.rs — the tray's end of the merged log. The supervisor writes it; the tray truncates
// it ONCE per session (it is the only process that knows a session began) and adds the
// `[host]` lines, which are what remain when the supervisor itself broke. See docs/tray.md.

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Mutex, OnceLock};

use crate::paths::{merged_log_path, lanes_dir};

/// The append handle every write goes through, behind a Mutex so our own lines can't interleave.
static LOG: OnceLock<Mutex<Option<std::fs::File>>> = OnceLock::new();

/// Truncate for a fresh session and open our append handle. Call once, BEFORE spawning the supervisor, which
/// opens the same file for append and would write into a file we are about to empty.
pub fn init() {
    let _ = std::fs::create_dir_all(lanes_dir());
    let _ = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(merged_log_path());
    LOG.get_or_init(|| {
        Mutex::new(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(merged_log_path())
                .ok(),
        )
    });
}

/// Write one tagged, timestamped line, byte-identical to the supervisor's: the web Logs panel polls this file
/// by byte offset, so the format is contract, not decoration. Best-effort — a log must never take the app down.
pub fn line(tag: &str, text: &str) {
    let Some(m) = LOG.get() else { return }; // init() hasn't run — nothing to write to
    if let Ok(mut guard) = m.lock() {
        if let Some(f) = guard.as_mut() {
            let ts = chrono::Local::now().format("%H:%M:%S");
            let _ = writeln!(f, "{ts} [{tag}] {text}");
        }
    }
}

/// Drain the supervisor's stderr into the merged log on a detached thread, living until the pipe closes.
/// Not optional: a piped child nobody reads blocks once the pipe buffer fills.
pub fn pump<R: Read + Send + 'static>(reader: R, tag: &'static str) {
    std::thread::spawn(move || {
        let mut buf = BufReader::new(reader);
        let mut s = String::new();
        loop {
            s.clear();
            match buf.read_line(&mut s) {
                Ok(0) | Err(_) => break, // EOF or a broken pipe — the process is gone
                Ok(_) => line(tag, s.trim_end_matches(['\r', '\n'])),
            }
        }
    });
}
