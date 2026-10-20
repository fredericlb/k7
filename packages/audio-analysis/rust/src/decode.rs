// decode.rs — an audio file to interleaved f32 frames with symphonia, for a host that has neither ffmpeg nor an engine.
// A reader would get wrong where the stream facts come from: the first DECODED buffer, since a container may not state them.

use crate::edit::{Edit, read_edit};
use std::io::{ErrorKind, Seek, SeekFrom};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CODEC_TYPE_NULL, Decoder as Codec, DecoderOptions};
use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

// The engine's bounds on a header (engine/k7-runtime/engine/Decode.cpp): past them it is a corrupt file.
const MAX_CHANNELS: usize = 32;
const MAX_SAMPLE_RATE: u32 = 768_000;

/// One file being decoded: the first audio track, every channel, at its own rate.
pub struct Decoder {
    format: Box<dyn FormatReader>,
    codec: Box<dyn Codec>,
    track: u32,
    pub sample_rate: u32,
    pub channels: usize,
    pending: Vec<f32>,
    edit: Option<Edit>,
    // Frames still to drop at the start, and still to keep, by the mp4 edit list.
    skip: u64,
    left: Option<u64>,
    ended: bool,
}

impl Decoder {
    /// Opens `source`; `extension` only helps the probe, which reads the content either way.
    pub fn open(mut source: Box<dyn MediaSource>, extension: &str) -> Result<Self, String> {
        let mut hint = Hint::new();
        if !extension.is_empty() {
            hint.with_extension(extension);
        }
        // Gapless trims the encoder delay and padding, as ffmpeg does, so onsets land where ffmpeg puts them.
        let edit = read_edit(&mut *source);
        source.seek(SeekFrom::Start(0)).map_err(|e| format!("cannot read: {e}"))?;
        let options = FormatOptions { enable_gapless: true, ..Default::default() };
        let probed = symphonia::default::get_probe()
            .format(&hint, MediaSourceStream::new(source, Default::default()), &options, &MetadataOptions::default())
            .map_err(|e| format!("unsupported format: {e}"))?;
        let format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("no audio stream")?;
        let codec = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("unsupported codec: {e}"))?;
        let track = track.id;
        let mut d = Decoder { format, codec, track, sample_rate: 0, channels: 0, pending: Vec::new(), edit, skip: 0, left: None, ended: false };
        let mut first = Vec::new();
        d.decode_packet(&mut first)?;
        if d.channels == 0 {
            return Err("no audio decoded".into());
        }
        d.pending = first;
        Ok(d)
    }

    /// Appends at least `frames` whole frames to `out` unless the stream ends first; returns how many it appended.
    pub fn next(&mut self, out: &mut Vec<f32>, frames: usize) -> Result<usize, String> {
        let start = out.len();
        out.append(&mut self.pending);
        while !self.ended && (out.len() - start) < frames * self.channels {
            self.decode_packet(out)?;
        }
        Ok((out.len() - start) / self.channels.max(1))
    }

    /// Decodes the next packet of the track into `out`, or marks the end.
    fn decode_packet(&mut self, out: &mut Vec<f32>) -> Result<(), String> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(Error::IoError(e)) if e.kind() == ErrorKind::UnexpectedEof => {
                    self.ended = true;
                    return Ok(());
                }
                // A chained stream asking for a reset is a new stream: the first one is the file's.
                Err(Error::ResetRequired) => {
                    self.ended = true;
                    return Ok(());
                }
                Err(e) => return Err(format!("cannot read: {e}")),
            };
            if packet.track_id() != self.track {
                continue;
            }
            let decoded = match self.codec.decode(&packet) {
                Ok(b) => b,
                // A corrupt frame is skipped, as ffmpeg skips it, rather than failing the whole file.
                Err(Error::DecodeError(_)) => continue,
                Err(e) => return Err(format!("cannot decode: {e}")),
            };
            let spec = *decoded.spec();
            let channels = spec.channels.count();
            if self.channels == 0 {
                if channels == 0 || channels > MAX_CHANNELS || spec.rate == 0 || spec.rate > MAX_SAMPLE_RATE {
                    return Err(format!("implausible stream ({channels} channel(s) at {} Hz)", spec.rate));
                }
                self.channels = channels;
                self.sample_rate = spec.rate;
                (self.skip, self.left) = self.edit.map_or((0, None), |e| e.frames(spec.rate));
            } else if channels != self.channels || spec.rate != self.sample_rate {
                return Err("the stream changes its channels or rate midway".into());
            }
            if decoded.frames() == 0 {
                continue;
            }
            let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
            buf.copy_interleaved_ref(decoded);
            self.emit(out, buf.samples());
            return Ok(());
        }
    }

    /// Appends `samples` to `out` past the frames the edit list drops and short of those it cuts.
    fn emit(&mut self, out: &mut Vec<f32>, samples: &[f32]) {
        let ch = self.channels;
        let frames = (samples.len() / ch) as u64;
        let drop = self.skip.min(frames);
        self.skip -= drop;
        let mut take = frames - drop;
        if let Some(left) = self.left.as_mut() {
            take = take.min(*left);
            *left -= take;
            self.ended = *left == 0;
        }
        let from = drop as usize * ch;
        out.extend_from_slice(&samples[from..from + take as usize * ch]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A 16-bit PCM wav of `frames` frames, each channel `c` of frame `f` holding `(f + c) % 100`.
    fn wav(rate: u32, channels: u16, frames: u32) -> Vec<u8> {
        let data = frames * u32::from(channels) * 2;
        let mut w = Vec::new();
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&(36 + data).to_le_bytes());
        w.extend_from_slice(b"WAVEfmt ");
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes());
        w.extend_from_slice(&channels.to_le_bytes());
        w.extend_from_slice(&rate.to_le_bytes());
        w.extend_from_slice(&(rate * u32::from(channels) * 2).to_le_bytes());
        w.extend_from_slice(&(channels * 2).to_le_bytes());
        w.extend_from_slice(&16u16.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&data.to_le_bytes());
        for f in 0..frames {
            for c in 0..u32::from(channels) {
                w.extend_from_slice(&(((f + c) % 100) as i16).to_le_bytes());
            }
        }
        w
    }

    #[test]
    fn decodes_every_frame_of_a_wav_in_order() {
        let mut d = Decoder::open(Box::new(Cursor::new(wav(44_100, 2, 10_000))), "wav").unwrap();
        assert_eq!((d.sample_rate, d.channels), (44_100, 2));
        let mut out = Vec::new();
        let mut total = 0;
        loop {
            let n = d.next(&mut out, 1000).unwrap();
            if n == 0 {
                break;
            }
            total += n;
        }
        assert_eq!(total, 10_000);
        assert_eq!(out.len(), 20_000);
        assert_eq!(out[2 * 4321 + 1], ((4321 + 1) % 100) as f32 / 32768.0);
    }

    #[test]
    fn refuses_what_is_not_audio() {
        let e = Decoder::open(Box::new(Cursor::new(b"not audio at all".repeat(100))), "").err().unwrap();
        assert!(e.starts_with("unsupported format"), "{e}");
    }
}
