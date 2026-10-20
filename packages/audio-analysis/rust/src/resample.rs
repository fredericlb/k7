// resample.rs — a stream of interleaved frames from one rate to another, with rubato's FFT resampler.
// A reader would get wrong the length: the resampler's delay is cut from the start and the tail flushed, so N frames in give ceil(N × ratio) out.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler};

/// Input frames per FFT chunk: a few hundred milliseconds of latency, which nothing here plays live.
const CHUNK: usize = 1024;

pub struct Resample {
    fft: Fft<f32>,
    channels: usize,
    from: u64,
    to: u64,
    input: Vec<f32>,
    out: Vec<f32>,
    delay_left: usize,
    frames_in: u64,
    frames_out: u64,
}

impl Resample {
    pub fn new(from: u32, to: u32, channels: usize) -> Result<Self, String> {
        let fft = Fft::<f32>::new(from as usize, to as usize, CHUNK, channels, FixedSync::Input)
            .map_err(|e| format!("cannot resample {from} Hz to {to} Hz: {e}"))?;
        let delay_left = fft.output_delay();
        Ok(Resample {
            fft,
            channels,
            from: u64::from(from),
            to: u64::from(to),
            input: Vec::new(),
            out: Vec::new(),
            delay_left,
            frames_in: 0,
            frames_out: 0,
        })
    }

    /// Appends the frames `input` resamples to, as far as whole chunks go, to `dest`.
    pub fn push(&mut self, input: &[f32], dest: &mut Vec<f32>) -> Result<(), String> {
        self.frames_in += (input.len() / self.channels) as u64;
        self.input.extend_from_slice(input);
        let mut used = 0;
        while self.input.len() / self.channels - used >= self.fft.input_frames_next() {
            let (n_in, n_out) = self.chunk(used, None)?;
            used += n_in;
            self.emit(n_out, u64::MAX, dest);
        }
        self.input.drain(..used * self.channels);
        Ok(())
    }

    /// Flushes what is held: the last partial chunk, then silence until every expected frame came out.
    pub fn finish(&mut self, dest: &mut Vec<f32>) -> Result<(), String> {
        let expected = (self.frames_in * self.to).div_ceil(self.from);
        let held = self.input.len() / self.channels;
        let (_, n_out) = self.chunk(0, Some(held))?;
        self.input.clear();
        self.emit(n_out, expected, dest);
        while self.frames_out < expected {
            let (_, n_out) = self.chunk(0, Some(0))?;
            if n_out == 0 {
                return Err("the resampler stopped before its tail".into());
            }
            self.emit(n_out, expected, dest);
        }
        Ok(())
    }

    fn chunk(&mut self, offset: usize, partial: Option<usize>) -> Result<(usize, usize), String> {
        let ch = self.channels;
        // A partial chunk reads `partial` frames and pads the rest with silence, but the adapter still spans a whole chunk.
        let need = offset + self.fft.input_frames_next();
        if self.input.len() < need * ch {
            self.input.resize(need * ch, 0.0);
        }
        let max = self.fft.output_frames_max();
        self.out.resize(max * ch, 0.0);
        let input = InterleavedSlice::new(&self.input[..], ch, self.input.len() / ch).map_err(|e| e.to_string())?;
        let mut output = InterleavedSlice::new_mut(&mut self.out[..], ch, max).map_err(|e| e.to_string())?;
        let mut indexing = Indexing::new();
        indexing.input_offset = offset;
        indexing.partial_len = partial;
        self.fft.process_into_buffer(&input, &mut output, Some(&indexing)).map_err(|e| e.to_string())
    }

    fn emit(&mut self, n_out: usize, cap: u64, dest: &mut Vec<f32>) {
        let skip = n_out.min(self.delay_left);
        self.delay_left -= skip;
        let take = ((n_out - skip) as u64).min(cap.saturating_sub(self.frames_out)) as usize;
        dest.extend_from_slice(&self.out[skip * self.channels..(skip + take) * self.channels]);
        self.frames_out += take as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, seconds: f32) -> Vec<f32> {
        let n = (rate as f32 * seconds) as usize;
        (0..n).map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin() * 0.5).collect()
    }

    #[test]
    fn gives_the_length_the_ratio_says_and_keeps_the_phase() {
        let input = sine(44_100, 1.3);
        let mut r = Resample::new(44_100, 48_000, 1).unwrap();
        let mut out = Vec::new();
        for block in input.chunks(777) {
            r.push(block, &mut out).unwrap();
        }
        r.finish(&mut out).unwrap();
        assert_eq!(out.len() as u64, (input.len() as f64 * 48_000.0 / 44_100.0).ceil() as u64);
        let want = sine(48_000, 1.3);
        // Away from the edges, the output is the same tone at the new rate, with no delay left in it.
        let worst = (5000..50_000).map(|i| (out[i] - want[i]).abs()).fold(0.0, f32::max);
        assert!(worst < 1e-3, "{worst}");
    }
}
