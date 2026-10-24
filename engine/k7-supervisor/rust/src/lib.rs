// lib.rs — the media library's decoder and resampler (packages/audio-analysis/rust) behind include/k7_audio.h, for the stem cut.
// A reader would get wrong what a panic does: every export catches it and hands it back as an error, never unwinding into C++.

use std::any::Any;
use std::ffi::{CStr, CString, c_char};
use std::fs::File;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use waveform::decode::Decoder;
use waveform::resample::Resample;

/// Frames asked of the decoder per block: about a second of a 44.1 kHz file.
const BLOCK: usize = 44_100;

pub struct K7Decode {
    decoder: Decoder,
    channels: usize,
    resample: Option<Resample>,
    raw: Vec<f32>,
    mapped: Vec<f32>,
    out: Vec<f32>,
    ended: bool,
}

pub struct K7Resample {
    resample: Resample,
    channels: usize,
    out: Vec<f32>,
}

fn panic_text(p: &(dyn Any + Send)) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_default()
}

/// Runs `f`, turning its error or its panic into `*error` and `fallback`.
fn guarded<T>(error: *mut *mut c_char, fallback: T, f: impl FnOnce() -> Result<T, String>) -> T {
    let message = match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(v)) => return v,
        Ok(Err(e)) => e,
        Err(p) => format!("the decoder failed: {}", panic_text(&*p)),
    };
    if !error.is_null() {
        let text = CString::new(message.replace('\0', " ")).unwrap_or_default();
        unsafe { *error = text.into_raw() };
    }
    fallback
}

/// `frames` from `from` channels to `to`, as the media library's encoder maps them: kept, the first two averaged, one doubled, or the first two kept.
fn map_channels(frames: &[f32], from: usize, to: usize, out: &mut Vec<f32>) {
    out.clear();
    if from == to {
        out.extend_from_slice(frames);
        return;
    }
    for frame in frames.chunks_exact(from) {
        let pair = &frame[..from.min(2)];
        let mono = pair.iter().sum::<f32>() / pair.len() as f32;
        match to {
            1 => out.push(mono),
            _ if from == 1 => out.extend(std::iter::repeat_n(mono, to)),
            _ => {
                out.extend(frame.iter().take(to));
                out.extend(std::iter::repeat_n(0.0, to.saturating_sub(from)));
            }
        }
    }
}

/// # Safety
/// `path` is a NUL-terminated string; `error` is null or writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_decode_open(path: *const c_char, rate: u32, channels: u32, error: *mut *mut c_char) -> *mut K7Decode {
    guarded(error, std::ptr::null_mut(), || {
        if path.is_null() || rate == 0 || channels == 0 {
            return Err("k7_decode_open: no path, rate or channel count".into());
        }
        let path = unsafe { CStr::from_ptr(path) }.to_str().map_err(|_| "the path is not UTF-8".to_string())?;
        let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
        let extension = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("");
        let decoder = Decoder::open(Box::new(file), extension).map_err(|e| format!("{path}: {e}"))?;
        let channels = channels as usize;
        let resample = (decoder.sample_rate != rate).then(|| Resample::new(decoder.sample_rate, rate, channels)).transpose()?;
        Ok(Box::into_raw(Box::new(K7Decode {
            decoder,
            channels,
            resample,
            raw: Vec::new(),
            mapped: Vec::new(),
            out: Vec::new(),
            ended: false,
        })))
    })
}

/// # Safety
/// `d` is null or a handle `k7_decode_open` returned and nothing closed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_decode_source_rate(d: *const K7Decode) -> u32 {
    unsafe { d.as_ref() }.map_or(0, |d| d.decoder.sample_rate)
}

/// # Safety
/// `d` as above; `frames` and `count` are writable; `error` is null or writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_decode_next(d: *mut K7Decode, frames: *mut *const f32, count: *mut usize, error: *mut *mut c_char) -> i32 {
    guarded(error, -1, || {
        let d = unsafe { d.as_mut() }.ok_or("no decoder open")?;
        d.out.clear();
        while d.out.is_empty() && !d.ended {
            d.raw.clear();
            if d.decoder.next(&mut d.raw, BLOCK)? == 0 {
                d.ended = true;
                if let Some(r) = &mut d.resample {
                    r.finish(&mut d.out)?;
                }
                continue;
            }
            map_channels(&d.raw, d.decoder.channels, d.channels, &mut d.mapped);
            match &mut d.resample {
                None => std::mem::swap(&mut d.out, &mut d.mapped),
                Some(r) => r.push(&d.mapped, &mut d.out)?,
            }
        }
        unsafe {
            *frames = d.out.as_ptr();
            *count = d.out.len() / d.channels;
        }
        Ok(0)
    })
}

/// # Safety
/// `d` is null or an open handle, which is not used again.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_decode_close(d: *mut K7Decode) {
    if !d.is_null() {
        drop(unsafe { Box::from_raw(d) });
    }
}

/// # Safety
/// `error` is null or writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_resample_new(from: u32, to: u32, channels: u32, error: *mut *mut c_char) -> *mut K7Resample {
    guarded(error, std::ptr::null_mut(), || {
        if from == 0 || to == 0 || channels == 0 {
            return Err("k7_resample_new: no rate or channel count".into());
        }
        let channels = channels as usize;
        let resample = Resample::new(from, to, channels)?;
        Ok(Box::into_raw(Box::new(K7Resample { resample, channels, out: Vec::new() })))
    })
}

/// # Safety
/// `r` is an open handle; `frames` holds `count` interleaved frames; `out` and `out_count` are writable; `error` is null or writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_resample_push(
    r: *mut K7Resample,
    frames: *const f32,
    count: usize,
    out: *mut *const f32,
    out_count: *mut usize,
    error: *mut *mut c_char,
) -> i32 {
    guarded(error, -1, || {
        let r = unsafe { r.as_mut() }.ok_or("no resampler open")?;
        r.out.clear();
        if count > 0 {
            let input = unsafe { std::slice::from_raw_parts(frames, count * r.channels) };
            r.resample.push(input, &mut r.out)?;
        }
        unsafe {
            *out = r.out.as_ptr();
            *out_count = r.out.len() / r.channels;
        }
        Ok(0)
    })
}

/// # Safety
/// As `k7_resample_push`, and called once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_resample_finish(r: *mut K7Resample, out: *mut *const f32, out_count: *mut usize, error: *mut *mut c_char) -> i32 {
    guarded(error, -1, || {
        let r = unsafe { r.as_mut() }.ok_or("no resampler open")?;
        r.out.clear();
        r.resample.finish(&mut r.out)?;
        unsafe {
            *out = r.out.as_ptr();
            *out_count = r.out.len() / r.channels;
        }
        Ok(0)
    })
}

/// # Safety
/// `r` is null or an open handle, which is not used again.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_resample_free(r: *mut K7Resample) {
    if !r.is_null() {
        drop(unsafe { Box::from_raw(r) });
    }
}

/// # Safety
/// `s` is null or a string an export above wrote to `*error`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn k7_audio_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(unsafe { CString::from_raw(s) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_mono_to_both_sides_and_keeps_the_first_two_of_many() {
        let mut out = Vec::new();
        map_channels(&[0.25, -0.5], 1, 2, &mut out);
        assert_eq!(out, [0.25, 0.25, -0.5, -0.5]);
        map_channels(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 3, 2, &mut out);
        assert_eq!(out, [0.1, 0.2, 0.4, 0.5]);
    }
}
