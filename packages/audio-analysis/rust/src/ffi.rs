// ffi.rs — the C ABI the WebAssembly build exports: samples pushed in, the mono signal kept inside, the arrays read back.
// A reader would get wrong where the mono signal lives: here, between the pushes and the measure, so it crosses the boundary once.

use crate::measure::{Measure, autocorr, push_mono};
use std::cell::RefCell;

thread_local! {
    static INPUT: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static MONO: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static OUT: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static CORR: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
}

/// A buffer of `len` floats to write samples into, valid until the next call on this thread.
#[unsafe(no_mangle)]
pub extern "C" fn wf_input(len: usize) -> *mut f32 {
    INPUT.with(|i| {
        let mut i = i.borrow_mut();
        i.resize(len, 0.0);
        i.as_mut_ptr()
    })
}

/// Appends the mono sum of the first `len` interleaved samples of the input buffer.
#[unsafe(no_mangle)]
pub extern "C" fn wf_push(len: usize, channels: usize) {
    INPUT.with(|i| {
        let input = i.borrow();
        MONO.with(|m| {
            push_mono(
                &mut m.borrow_mut(),
                &input[..len.min(input.len())],
                channels,
            )
        });
    });
}

/// The frames pushed so far.
#[unsafe(no_mangle)]
pub extern "C" fn wf_frames() -> f64 {
    MONO.with(|m| m.borrow().len() as f64)
}

/// Measures what was pushed and lets it go; the output is peak, rms, low, mid, high (each `buckets` long), then the tempo envelope.
#[unsafe(no_mangle)]
pub extern "C" fn wf_measure(a_low: f64, a_high: f64) -> usize {
    let mono = MONO.with(|m| std::mem::take(&mut *m.borrow_mut()));
    let r = Measure::run(&mono, a_low, a_high);
    drop(mono);
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        for part in [&r.peak, &r.rms, &r.low, &r.mid, &r.high, &r.tempo] {
            o.extend_from_slice(part);
        }
    });
    r.peak.len()
}

#[unsafe(no_mangle)]
pub extern "C" fn wf_output_ptr() -> *const f32 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn wf_output_len() -> usize {
    OUT.with(|o| o.borrow().len())
}

/// detectBpm's correlations for the first `len` floats of the input buffer, at every lag of [min_lag, max_lag].
#[unsafe(no_mangle)]
pub extern "C" fn wf_autocorr(len: usize, min_lag: usize, max_lag: usize) -> *const f64 {
    let c = INPUT.with(|i| autocorr(&i.borrow()[..len], min_lag, max_lag));
    CORR.with(|k| {
        *k.borrow_mut() = c;
        k.borrow().as_ptr()
    })
}

/// Forgets every buffer, for a host that keeps one instance between files.
#[unsafe(no_mangle)]
pub extern "C" fn wf_reset() {
    for buf in [&INPUT, &MONO, &OUT] {
        buf.with(|b| *b.borrow_mut() = Vec::new());
    }
    CORR.with(|c| *c.borrow_mut() = Vec::new());
}
