// portable-stub.rs — the launcher half of the portable build. It carries the whole app as a
// zip appended to its own file, unpacks it once under %LOCALAPPDATA% and runs the tray from
// there, so every path the app resolves beside its executable still resolves. Compiled by
// build-portable.mjs with plain rustc: no crates, no cargo project.
// See scripts/docs/buildPortable.md.

#![windows_subsystem = "windows"]

use std::ffi::{c_void, OsStr};
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

// The trailer build-portable.mjs writes: 16 bytes of build id, the payload length, the magic.
const TRAILER: usize = 32;
const MAGIC: &[u8; 8] = b"ST0PORT1";

// CREATE_NO_WINDOW — this launcher has no console and must not flash one for its helper.
const NO_WINDOW: u32 = 0x0800_0000;

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(hwnd: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// Say what went wrong, in a box: a windowless launcher that fails quietly looks like a dead double-click.
fn die(message: &str) -> ! {
    let text = wide(message);
    let caption = wide("st0");
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
    }
    std::process::exit(1)
}

/// Where the app is unpacked — per user, and keyed on the build so a newer launcher never reuses an older tree.
fn unpack_root() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("st0").join("portable")
}

/// Unpack the payload into `dest`, through a staging directory so a killed run leaves no half tree.
fn unpack(payload: &[u8], root: &Path, dest: &Path) {
    let staging = root.join(format!(
        "{}.unpacking",
        dest.file_name().and_then(|n| n.to_str()).unwrap_or("build")
    ));
    let _ = fs::remove_dir_all(&staging);
    if let Err(e) = fs::create_dir_all(&staging) {
        die(&format!("cannot create {}: {e}", staging.display()));
    }

    let archive = staging.with_extension("zip");
    if let Err(e) = fs::write(&archive, payload) {
        die(&format!("cannot write {}: {e}", archive.display()));
    }

    // System32's bsdtar BY PATH: it reads .zip, where a `tar` found on PATH may be GNU tar, which does not.
    let system32 = PathBuf::from(std::env::var("SystemRoot").unwrap_or("C:\\Windows".into()))
        .join("System32")
        .join("tar.exe");
    let status = Command::new(&system32)
        .args(["-xf".as_ref(), archive.as_os_str(), "-C".as_ref(), staging.as_os_str()])
        .creation_flags(NO_WINDOW)
        .status();
    match status {
        Ok(s) if s.success() => {}
        Ok(s) => die(&format!("unpacking failed ({s}) — {}", archive.display())),
        Err(e) => die(&format!("cannot run {}: {e}", system32.display())),
    }

    let _ = fs::remove_file(&archive);
    let _ = fs::remove_dir_all(dest);
    if let Err(e) = fs::rename(&staging, dest) {
        die(&format!("cannot move the unpacked app to {}: {e}", dest.display()));
    }
}

fn main() {
    let exe = std::env::current_exe()
        .unwrap_or_else(|e| die(&format!("cannot locate this executable: {e}")));
    let bytes =
        fs::read(&exe).unwrap_or_else(|e| die(&format!("cannot read {}: {e}", exe.display())));

    if bytes.len() < TRAILER || &bytes[bytes.len() - 8..] != MAGIC {
        die("this launcher carries no payload — it is the bare stub, not the packed build.");
    }
    let trailer = &bytes[bytes.len() - TRAILER..];
    let build = String::from_utf8_lossy(&trailer[..16]).trim().to_string();
    let len = u64::from_le_bytes(trailer[16..24].try_into().unwrap()) as usize;
    let end = bytes.len() - TRAILER;
    if build.is_empty() || len > end {
        die("the appended archive is truncated — repack it.");
    }

    let root = unpack_root();
    let dest = root.join(&build);
    let tray = dest.join("st0-tray.exe");
    if !tray.is_file() {
        if let Err(e) = fs::create_dir_all(&root) {
            die(&format!("cannot create {}: {e}", root.display()));
        }
        unpack(&bytes[end - len..end], &root, &dest);
    }
    if !tray.is_file() {
        die(&format!("{} is missing after unpacking.", tray.display()));
    }

    // Started from its own directory, because that is where it finds the engine, node and resources.
    if let Err(e) = Command::new(&tray)
        .args(std::env::args_os().skip(1))
        .current_dir(&dest)
        .spawn()
    {
        die(&format!("cannot start {}: {e}", tray.display()));
    }
}
