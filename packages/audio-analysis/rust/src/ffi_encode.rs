// ffi_encode.rs — the encoders' C ABI for WebAssembly: frames taken from the decoder's last block, bytes written through the host's `write`.
// A reader would get wrong what crosses the boundary: no samples do — `enc_push_decoded` reads the block `dec_next` left (docs/transcode.md).

use crate::encode::{Output, Pipeline};
use crate::ffi_decode::{fail, with_decoded};
use crate::sink::Sink;
use ebur128::{EbuR128, Mode};
use std::cell::RefCell;

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    /// Writes `len` bytes at `ptr` to the output file at `pos`; negative on failure.
    fn write(ptr: *const u8, len: usize, pos: f64) -> i32;
}

struct HostSink;

impl Sink for HostSink {
    fn write_at(&mut self, pos: u64, bytes: &[u8]) -> Result<(), String> {
        if unsafe { write(bytes.as_ptr(), bytes.len(), pos as f64) } < 0 {
            return Err("the host could not write the file".into());
        }
        Ok(())
    }
}

thread_local! {
    static PIPE: RefCell<Option<Pipeline>> = const { RefCell::new(None) };
    static METER: RefCell<Option<EbuR128>> = const { RefCell::new(None) };
}

/// Frames `[from, from + count)` of the decoder's last block, or None past its end.
fn slice(frames: &[f32], channels: usize, from: i32, count: i32) -> Option<&[f32]> {
    let (a, n) = (usize::try_from(from).ok()? * channels, usize::try_from(count).ok()? * channels);
    frames.get(a..a.checked_add(n)?)
}

/// Opens the output: `kind` 0 is Opus at `param` bits/s, 1 FLAC at `param` bits, 2 a 16-bit WAV at `param` Hz; `channels` 0 keeps the source's.
#[unsafe(no_mangle)]
pub extern "C" fn enc_open(kind: i32, in_rate: f64, in_channels: i32, channels: i32, param: f64) -> i32 {
    let output = match kind {
        0 => Output::Opus { bitrate: param as i32 },
        1 => Output::Flac { bits: param as usize },
        2 => Output::Wav16 { rate: param as u32 },
        _ => return fail(format!("no output of kind {kind}")),
    };
    match Pipeline::new(HostSink, output, in_rate as u32, in_channels.max(1) as usize, channels.max(0) as usize) {
        Ok(p) => {
            PIPE.with(|s| *s.borrow_mut() = Some(p));
            0
        }
        Err(e) => fail(e),
    }
}

/// Encodes frames `[from, from + count)` of the decoder's last block, each sample times `gain`: 0, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn enc_push_decoded(from: i32, count: i32, gain: f32) -> i32 {
    PIPE.with(|s| {
        let mut s = s.borrow_mut();
        let Some(p) = s.as_mut() else { return fail("no output open".into()) };
        with_decoded(|frames, channels| match slice(frames, channels, from, count) {
            None => fail("past the decoded block".into()),
            Some(part) => p.push(part, gain).map_or_else(fail, |()| 0),
        })
    })
}

/// The next frames come at `in_rate` with `in_channels`, as the next file of a join: 0, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn enc_reformat(in_rate: f64, in_channels: i32) -> i32 {
    PIPE.with(|s| {
        let mut s = s.borrow_mut();
        let Some(p) = s.as_mut() else { return fail("no output open".into()) };
        p.reformat(in_rate as u32, in_channels.max(1) as usize).map_or_else(fail, |()| 0)
    })
}

/// Writes what is held and closes the output: the frames it holds, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn enc_finish() -> f64 {
    match PIPE.with(|s| s.borrow_mut().take()) {
        None => f64::from(fail("no output open".into())),
        Some(p) => p.finish().map_or_else(|e| f64::from(fail(e)), |n| n as f64),
    }
}

/// Starts an EBU R128 measure, integrated loudness and true peak.
#[unsafe(no_mangle)]
pub extern "C" fn lufs_open(rate: f64, channels: i32) -> i32 {
    match EbuR128::new(channels.max(1) as u32, rate as u32, Mode::I | Mode::TRUE_PEAK) {
        Ok(m) => {
            METER.with(|s| *s.borrow_mut() = Some(m));
            0
        }
        Err(e) => fail(format!("cannot measure loudness: {e}")),
    }
}

/// Measures frames `[from, from + count)` of the decoder's last block: 0, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn lufs_push_decoded(from: i32, count: i32) -> i32 {
    METER.with(|s| {
        let mut s = s.borrow_mut();
        let Some(m) = s.as_mut() else { return fail("no measure open".into()) };
        with_decoded(|frames, channels| match slice(frames, channels, from, count) {
            None => fail("past the decoded block".into()),
            Some(part) => m.add_frames_f32(part).map_or_else(|e| fail(e.to_string()), |()| 0),
        })
    })
}

/// The integrated loudness in LUFS; negative infinity for silence.
#[unsafe(no_mangle)]
pub extern "C" fn lufs_integrated() -> f64 {
    METER.with(|s| s.borrow().as_ref().and_then(|m| m.loudness_global().ok()).unwrap_or(f64::NEG_INFINITY))
}

/// The loudest true peak over every channel, in dBTP.
#[unsafe(no_mangle)]
pub extern "C" fn lufs_true_peak() -> f64 {
    METER.with(|s| {
        let s = s.borrow();
        let Some(m) = s.as_ref() else { return f64::NEG_INFINITY };
        let peak = (0..m.channels()).filter_map(|c| m.true_peak(c).ok()).fold(0.0, f64::max);
        20.0 * peak.log10()
    })
}
