// lib.rs — the hot loops of a waveform sidecar, in Rust: what ../src/envelope.ts and decode.ts compute per sample.
// A reader would get wrong what is here: only arithmetic that is exact in both languages; exp/log constants come in from JS (docs/analysis.md).

pub mod ffi;
pub mod measure;

pub use measure::{Measure, Measured, autocorr, push_mono};
