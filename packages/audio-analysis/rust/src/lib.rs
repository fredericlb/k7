// lib.rs — the hot loops of a waveform sidecar, in Rust: what ../src/envelope.ts and decode.ts compute per sample.
// A reader would get wrong what is here: only arithmetic that is exact in both languages; exp/log constants come in from JS (docs/analysis.md).

#[cfg(feature = "decode")]
pub mod decode;
#[cfg(feature = "decode")]
pub mod edit;
pub mod ffi;
#[cfg(all(feature = "decode", target_arch = "wasm32"))]
pub mod ffi_decode;
pub mod measure;
#[cfg(feature = "decode")]
pub mod opus;
#[cfg(feature = "decode")]
pub mod webm;
#[cfg(feature = "encode")]
pub mod coders;
#[cfg(feature = "encode")]
pub mod encode;
#[cfg(all(feature = "encode", target_arch = "wasm32"))]
pub mod ffi_encode;
#[cfg(feature = "encode")]
pub mod resample;
#[cfg(feature = "encode")]
pub mod sink;
#[cfg(feature = "encode")]
pub mod webm_write;

pub use measure::{Measure, Measured, autocorr, push_mono};
