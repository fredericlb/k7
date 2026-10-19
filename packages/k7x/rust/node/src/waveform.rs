// waveform.rs — the waveform measure in this addon: wfReset/wfPush/wfMeasure/wfAutocorr, the shape audio-analysis's native.ts takes.
// A reader would get wrong where the mono signal is held: per THREAD, as each of the file service's worker threads is one analysis at a time.

use crate::napi::*;
use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr;
use waveform::{Measure, autocorr, push_mono};

thread_local! {
    static MONO: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

/// The floats of a Float32Array argument, borrowed for the call.
unsafe fn f32_arg<'a>(env: napi_env, v: napi_value) -> Option<&'a [f32]> {
    let (mut kind, mut len, mut data) = (0, 0, ptr::null_mut());
    let got = unsafe {
        napi_get_typedarray_info(
            env,
            v,
            &mut kind,
            &mut len,
            &mut data,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if got != NAPI_OK || kind != FLOAT32 {
        return None;
    }
    if len == 0 {
        return Some(&[]);
    }
    Some(unsafe { std::slice::from_raw_parts(data.cast::<f32>(), len) })
}

unsafe fn number(env: napi_env, v: napi_value) -> Option<f64> {
    let mut out = 0.0;
    (unsafe { napi_get_value_double(env, v, &mut out) } == NAPI_OK).then_some(out)
}

/// A new typed array of `kind` holding `values`.
unsafe fn typed<T: Copy>(env: napi_env, kind: i32, values: &[T]) -> napi_value {
    let bytes = std::mem::size_of_val(values);
    let (mut data, mut buffer, mut out): (*mut c_void, napi_value, napi_value) =
        (ptr::null_mut(), ptr::null_mut(), ptr::null_mut());
    unsafe {
        napi_create_arraybuffer(env, bytes, &mut data, &mut buffer);
        if bytes > 0 {
            ptr::copy_nonoverlapping(values.as_ptr().cast::<u8>(), data.cast::<u8>(), bytes);
        }
        napi_create_typedarray(env, kind, values.len(), buffer, 0, &mut out);
    }
    out
}

unsafe fn undefined(env: napi_env) -> napi_value {
    let mut u = ptr::null_mut();
    unsafe { napi_get_undefined(env, &mut u) };
    u
}

pub unsafe extern "C" fn wf_reset(env: napi_env, _info: napi_callback_info) -> napi_value {
    MONO.with(|m| *m.borrow_mut() = Vec::new());
    unsafe { undefined(env) }
}

pub unsafe extern "C" fn wf_push(env: napi_env, info: napi_callback_info) -> napi_value {
    unsafe {
        let [samples, channels] = args::<2>(env, info);
        let (Some(samples), Some(channels)) = (f32_arg(env, samples), number(env, channels)) else {
            return type_error(env, c"waveform: wfPush(Float32Array, channels)");
        };
        MONO.with(|m| push_mono(&mut m.borrow_mut(), samples, channels as usize));
        undefined(env)
    }
}

pub unsafe extern "C" fn wf_measure(env: napi_env, info: napi_callback_info) -> napi_value {
    unsafe {
        let [a_low, a_high] = args::<2>(env, info);
        let (Some(a_low), Some(a_high)) = (number(env, a_low), number(env, a_high)) else {
            return type_error(env, c"waveform: wfMeasure(aLow, aHigh)");
        };
        let mono = MONO.with(|m| std::mem::take(&mut *m.borrow_mut()));
        let r = Measure::run(&mono, a_low, a_high);
        drop(mono);
        let mut flat = Vec::with_capacity(r.peak.len() * 5 + r.tempo.len());
        for part in [&r.peak, &r.rms, &r.low, &r.mid, &r.high, &r.tempo] {
            flat.extend_from_slice(part);
        }
        let (mut out, mut buckets) = (ptr::null_mut(), ptr::null_mut());
        napi_create_array_with_length(env, 2, &mut out);
        napi_create_uint32(env, r.peak.len() as u32, &mut buckets);
        napi_set_element(env, out, 0, buckets);
        napi_set_element(env, out, 1, typed(env, FLOAT32, &flat));
        out
    }
}

pub unsafe extern "C" fn wf_autocorr(env: napi_env, info: napi_callback_info) -> napi_value {
    unsafe {
        let [onset, min_lag, max_lag] = args::<3>(env, info);
        let (Some(onset), Some(min_lag), Some(max_lag)) = (
            f32_arg(env, onset),
            number(env, min_lag),
            number(env, max_lag),
        ) else {
            return type_error(env, c"waveform: wfAutocorr(Float32Array, minLag, maxLag)");
        };
        typed(
            env,
            FLOAT64,
            &autocorr(onset, min_lag as usize, max_lag as usize),
        )
    }
}
