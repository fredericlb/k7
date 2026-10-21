// encode.rs — decoded frames to a file: a gain, the channels mapped, the rate converted, then one of the coders.
// A reader would get wrong the mono sum: the first one or two channels averaged, as the envelope's (docs/analysis.md), never a downmix.

use crate::coders::{Coder, Flac, OpusWebm, Wav16};
use crate::resample::Resample;
use crate::sink::Sink;

pub enum Output {
    /// Opus at this many bits per second, in WebM; always 48 kHz, one or two channels.
    Opus { bitrate: i32 },
    /// FLAC at this many bits per sample, at the source's rate.
    Flac { bits: usize },
    /// 16-bit PCM WAV at this rate.
    Wav16 { rate: u32 },
}

pub struct Pipeline {
    in_channels: usize,
    out_channels: usize,
    out_rate: u32,
    resample: Option<Resample>,
    coder: Box<dyn Coder>,
    mapped: Vec<f32>,
    resampled: Vec<f32>,
}

/// `channels` asked for, 0 meaning the source's; Opus holds two at most.
fn out_channels(output: &Output, source: usize, asked: usize) -> usize {
    let want = if asked == 0 { source } else { asked };
    match output {
        Output::Opus { .. } => want.clamp(1, 2),
        _ => want.max(1),
    }
}

impl Pipeline {
    pub fn new<S: Sink + 'static>(
        sink: S,
        output: Output,
        in_rate: u32,
        in_channels: usize,
        channels: usize,
    ) -> Result<Self, String> {
        let out_ch = out_channels(&output, in_channels, channels);
        let out_rate = match output {
            Output::Opus { .. } => 48_000,
            Output::Flac { .. } => in_rate,
            Output::Wav16 { rate } => rate,
        };
        let coder: Box<dyn Coder> = match output {
            Output::Opus { bitrate } => Box::new(OpusWebm::new(sink, out_ch, bitrate, in_rate)?),
            Output::Flac { bits } => Box::new(Flac::new(sink, in_rate, out_ch, bits)?),
            Output::Wav16 { rate } => Box::new(Wav16::new(sink, rate, out_ch)?),
        };
        let resample = (out_rate != in_rate).then(|| Resample::new(in_rate, out_rate, out_ch)).transpose()?;
        Ok(Pipeline {
            in_channels,
            out_channels: out_ch,
            out_rate,
            resample,
            coder,
            mapped: Vec::new(),
            resampled: Vec::new(),
        })
    }

    /// Frames from now on come at `in_rate` with `in_channels`, as the next file of a join does: the old resampler's tail goes out first.
    pub fn reformat(&mut self, in_rate: u32, in_channels: usize) -> Result<(), String> {
        self.flush()?;
        self.in_channels = in_channels.max(1);
        self.resample =
            (self.out_rate != in_rate).then(|| Resample::new(in_rate, self.out_rate, self.out_channels)).transpose()?;
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        if let Some(r) = &mut self.resample {
            self.resampled.clear();
            r.finish(&mut self.resampled)?;
            self.coder.push(&self.resampled)?;
        }
        Ok(())
    }

    /// Interleaved frames at the source's rate and channel count, each sample times `gain`.
    pub fn push(&mut self, frames: &[f32], gain: f32) -> Result<(), String> {
        map_channels(frames, self.in_channels, self.out_channels, gain, &mut self.mapped);
        match &mut self.resample {
            None => self.coder.push(&self.mapped),
            Some(r) => {
                self.resampled.clear();
                r.push(&self.mapped, &mut self.resampled)?;
                self.coder.push(&self.resampled)
            }
        }
    }

    /// The frames written, at the output's rate.
    pub fn finish(mut self) -> Result<u64, String> {
        self.flush()?;
        self.coder.finish()
    }
}

/// `frames` from `from` channels to `to`: kept, the first two averaged into one, one doubled, or the first two kept.
fn map_channels(frames: &[f32], from: usize, to: usize, gain: f32, out: &mut Vec<f32>) {
    out.clear();
    if from == to {
        out.extend(frames.iter().map(|&s| s * gain));
        return;
    }
    for frame in frames.chunks_exact(from) {
        let pair = &frame[..from.min(2)];
        let mono = pair.iter().sum::<f32>() / pair.len() as f32 * gain;
        match to {
            1 => out.push(mono),
            _ if from == 1 => out.extend(std::iter::repeat_n(mono, to)),
            _ => {
                out.extend(frame.iter().take(to).map(|&s| s * gain));
                out.extend(std::iter::repeat_n(0.0, to.saturating_sub(from)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode::Decoder;
    use std::io::Cursor;
    use std::sync::{Arc, Mutex};

    /// A sink the test reads back after the pipeline consumed it.
    #[derive(Clone, Default)]
    struct Shared(Arc<Mutex<Vec<u8>>>);
    impl Sink for Shared {
        fn write_at(&mut self, pos: u64, bytes: &[u8]) -> Result<(), String> {
            self.0.lock().unwrap().write_at(pos, bytes)
        }
    }

    fn tone(rate: u32, seconds: f32, channels: usize) -> Vec<f32> {
        let n = (rate as f32 * seconds) as usize;
        (0..n)
            .flat_map(|i| {
                let s = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin() * 0.4;
                std::iter::repeat_n(s, channels)
            })
            .collect()
    }

    fn encode(output: Output, rate: u32, channels: usize, want: usize, input: &[f32]) -> (Vec<u8>, u64) {
        let sink = Shared::default();
        let mut p = Pipeline::new(sink.clone(), output, rate, channels, want).unwrap();
        for block in input.chunks(4410 * channels) {
            p.push(block, 1.0).unwrap();
        }
        let frames = p.finish().unwrap();
        let bytes = sink.0.lock().unwrap().clone();
        (bytes, frames)
    }

    fn decode(bytes: Vec<u8>, ext: &str) -> (u32, usize, Vec<f32>) {
        let mut d = Decoder::open(Box::new(Cursor::new(bytes)), ext).unwrap();
        let mut out = Vec::new();
        while d.next(&mut out, 65_536).unwrap() > 0 {}
        (d.sample_rate, d.channels, out)
    }

    #[test]
    fn opus_in_webm_decodes_to_every_frame_in_place() {
        let input = tone(44_100, 2.0, 2);
        let (bytes, frames) = encode(Output::Opus { bitrate: 128_000 }, 44_100, 2, 0, &input);
        assert_eq!(frames, 96_000);
        let (rate, channels, out) = decode(bytes, "webm");
        assert_eq!((rate, channels), (48_000, 2));
        assert_eq!(out.len(), 96_000 * 2);
        let want = tone(48_000, 2.0, 2);
        // Lossy, but in phase: a delay of even one sample would put the error near the signal's own size.
        let err: f32 = (4000..90_000).map(|i| (out[i] - want[i]).powi(2)).sum::<f32>() / 86_000.0;
        let sig: f32 = (4000..90_000).map(|i| want[i].powi(2)).sum::<f32>() / 86_000.0;
        assert!(10.0 * (sig / err).log10() > 20.0, "SNR too low");
    }

    #[test]
    fn flac_is_lossless_to_its_bit_depth() {
        let input = tone(48_000, 1.0, 2);
        let (bytes, frames) = encode(Output::Flac { bits: 24 }, 48_000, 2, 0, &input);
        assert_eq!(frames, 48_000);
        let (rate, channels, out) = decode(bytes, "flac");
        assert_eq!((rate, channels, out.len()), (48_000, 2, input.len()));
        let worst = input.iter().zip(&out).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!(worst < 1e-6, "{worst}");
    }

    #[test]
    fn wav_takes_the_mono_sum_at_the_rate_asked() {
        let input = tone(44_100, 1.0, 2);
        let (bytes, frames) = encode(Output::Wav16 { rate: 16_000 }, 44_100, 2, 1, &input);
        assert_eq!(frames, 16_000);
        let (rate, channels, out) = decode(bytes, "wav");
        assert_eq!((rate, channels, out.len()), (16_000, 1, 16_000));
    }

    #[test]
    fn joins_two_rates_into_one_stream() {
        let sink = Shared::default();
        let mut p = Pipeline::new(sink.clone(), Output::Wav16 { rate: 48_000 }, 44_100, 1, 2).unwrap();
        p.push(&tone(44_100, 0.5, 1), 1.0).unwrap();
        p.reformat(48_000, 2).unwrap();
        p.push(&tone(48_000, 0.25, 2), 1.0).unwrap();
        assert_eq!(p.finish().unwrap(), 24_000 + 12_000);
        let (rate, channels, out) = decode(sink.0.lock().unwrap().clone(), "wav");
        assert_eq!((rate, channels, out.len()), (48_000, 2, 36_000 * 2));
    }

    #[test]
    fn maps_channels_the_way_the_envelope_sums_them() {
        let mut out = Vec::new();
        map_channels(&[1.0, 0.0, 9.0], 3, 1, 1.0, &mut out);
        assert_eq!(out, [0.5]);
        map_channels(&[0.25], 1, 2, 2.0, &mut out);
        assert_eq!(out, [0.5, 0.5]);
        map_channels(&[0.1, 0.2, 0.3], 3, 2, 1.0, &mut out);
        assert_eq!(out, [0.1, 0.2]);
    }
}
