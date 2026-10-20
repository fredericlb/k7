// ffi_decode.rs — the decoder's C ABI for WebAssembly: the file is read through the host's `read`, never copied in whole.
// A reader would get wrong that one instance decodes one file: each export acts on the decoder `dec_open` left here.

use crate::decode::Decoder;
use std::cell::RefCell;
use std::io::{self, Read, Seek, SeekFrom};
use symphonia::core::io::MediaSource;

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    /// Reads up to `len` bytes of the file at `pos` into `ptr`; the count read, or a negative on failure.
    fn read(ptr: *mut u8, len: usize, pos: f64) -> i32;
}

/// The file being decoded, as the host holds it open.
struct HostFile {
    pos: u64,
    len: u64,
}

impl Read for HostFile {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = unsafe { read(buf.as_mut_ptr(), buf.len(), self.pos as f64) };
        if n < 0 {
            return Err(io::Error::other("the host could not read the file"));
        }
        self.pos += n as u64;
        Ok(n as usize)
    }
}

impl Seek for HostFile {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let at = match to {
            SeekFrom::Start(p) => p as i128,
            SeekFrom::End(d) => self.len as i128 + d as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
        };
        if at < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before the start"));
        }
        self.pos = at as u64;
        Ok(self.pos)
    }
}

impl MediaSource for HostFile {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        Some(self.len)
    }
}

thread_local! {
    static DECODER: RefCell<Option<Decoder>> = const { RefCell::new(None) };
    static HINT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static FRAMES: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

fn fail(e: String) -> i32 {
    ERROR.with(|m| *m.borrow_mut() = e);
    -1
}

/// A buffer of `len` bytes for the file's extension, read by the next `dec_open`.
#[unsafe(no_mangle)]
pub extern "C" fn dec_hint(len: usize) -> *mut u8 {
    HINT.with(|h| {
        let mut h = h.borrow_mut();
        h.resize(len, 0);
        h.as_mut_ptr()
    })
}

/// Opens the host's file of `len` bytes: 0, or -1 with the reason at `dec_error_ptr`.
#[unsafe(no_mangle)]
pub extern "C" fn dec_open(len: f64) -> i32 {
    let ext = HINT.with(|h| String::from_utf8_lossy(&h.borrow()).into_owned());
    match Decoder::open(Box::new(HostFile { pos: 0, len: len as u64 }), &ext) {
        Ok(d) => {
            DECODER.with(|s| *s.borrow_mut() = Some(d));
            0
        }
        Err(e) => fail(e),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn dec_rate() -> f64 {
    DECODER.with(|s| s.borrow().as_ref().map_or(0.0, |d| f64::from(d.sample_rate)))
}

#[unsafe(no_mangle)]
pub extern "C" fn dec_channels() -> i32 {
    DECODER.with(|s| s.borrow().as_ref().map_or(0, |d| d.channels as i32))
}

/// Decodes about `frames` more frames to `dec_frames_ptr`: how many, 0 at the end, -1 on failure.
#[unsafe(no_mangle)]
pub extern "C" fn dec_next(frames: usize) -> i32 {
    DECODER.with(|s| {
        let mut s = s.borrow_mut();
        let Some(d) = s.as_mut() else { return fail("no file open".into()) };
        FRAMES.with(|f| {
            let mut f = f.borrow_mut();
            f.clear();
            match d.next(&mut f, frames) {
                Ok(n) => n as i32,
                Err(e) => fail(e),
            }
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn dec_frames_ptr() -> *const f32 {
    FRAMES.with(|f| f.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn dec_error_ptr() -> *const u8 {
    ERROR.with(|m| m.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn dec_error_len() -> usize {
    ERROR.with(|m| m.borrow().len())
}
