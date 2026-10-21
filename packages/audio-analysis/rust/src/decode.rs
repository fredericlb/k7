// decode.rs — an audio file to interleaved f32 frames with symphonia, for a host that has neither ffmpeg nor an engine.
// A reader would get wrong where the stream facts come from: the first DECODED buffer, since a container may not state them.

use crate::edit::{Edit, read_edit};
use crate::opus::{self, Opus};
use crate::webm;
use std::io::{ErrorKind, Seek, SeekFrom};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::codecs::audio::well_known::CODEC_ID_OPUS;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions, CODEC_ID_NULL_AUDIO};
use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatReader, SeekMode, SeekTo};
use symphonia::core::units::Time;
use symphonia::core::formats::probe::Hint;
use symphonia::core::io::{MediaSource, MediaSourceStream};

// The engine's bounds on a header (engine/k7-runtime/engine/Decode.cpp): past them it is a corrupt file.
const MAX_CHANNELS: usize = 32;
const MAX_SAMPLE_RATE: u32 = 768_000;

/// symphonia's decoders, or opus-rs for the one codec symphonia does not decode.
enum Codec {
    Symphonia(Box<dyn AudioDecoder>),
    Opus(Box<Opus>),
}

/// One file being decoded: the first audio track, every channel, at its own rate.
pub struct Decoder {
    format: Box<dyn FormatReader>,
    codec: Codec,
    track: u32,
    pub sample_rate: u32,
    pub channels: usize,
    pending: Vec<f32>,
    scratch: Vec<f32>,
    edit: Option<Edit>,
    // Opus's pre-skip, which no symphonia decoder is there to trim.
    priming: u64,
    // Frames still to drop at the start, and still to keep, by the mp4 edit list and the priming.
    skip: u64,
    left: Option<u64>,
    // A webm's end padding: this many frames are held back, and the last of them never handed over.
    hold: u64,
    held: Vec<f32>,
    ended: bool,
    // The last packet that gave samples: its time and the frames trimmed from its head, which a seek reads its position from.
    last: Option<(f64, u64)>,
}

impl Decoder {
    /// Opens `source`; `extension` only helps the probe, which reads the content either way.
    pub fn open(mut source: Box<dyn MediaSource>, extension: &str) -> Result<Self, String> {
        let edit = read_edit(&mut *source);
        source.seek(SeekFrom::Start(0)).map_err(|e| format!("cannot read: {e}"))?;
        let padding = webm::end_padding(&mut *source, opus::RATE);
        source.seek(SeekFrom::Start(0)).map_err(|e| format!("cannot read: {e}"))?;
        let mut hint = Hint::new();
        if !extension.is_empty() {
            hint.with_extension(extension);
        }
        let format = symphonia::default::get_probe()
            .probe(&hint, MediaSourceStream::new(source, Default::default()), Default::default(), Default::default())
            .map_err(|e| format!("unsupported format: {e}"))?;
        let (track, delay, params) = format
            .tracks()
            .iter()
            .find_map(|t| match &t.codec_params {
                Some(CodecParameters::Audio(a)) if a.codec != CODEC_ID_NULL_AUDIO => Some((t.id, t.delay, a.clone())),
                _ => None,
            })
            .ok_or("no audio stream")?;
        let extra = params.extra_data.as_deref();
        let mut hold = 0;
        let (codec, priming) = if params.codec == CODEC_ID_OPUS {
            let channels = params.channels.as_ref().map(|c| c.count()).or(opus::head_channels(extra)).unwrap_or(2);
            hold = padding.unwrap_or(0);
            (Codec::Opus(Box::new(Opus::new(channels)?)), opus::pre_skip(delay, extra))
        } else {
            // Gapless is on by default: mp3's encoder delay is trimmed as ffmpeg trims it.
            let codec = symphonia::default::get_codecs()
                .make_audio_decoder(&params, &AudioDecoderOptions::default())
                .map_err(|e| format!("unsupported codec: {e}"))?;
            (Codec::Symphonia(codec), 0)
        };
        let mut d = Decoder {
            format,
            codec,
            track,
            sample_rate: 0,
            channels: 0,
            pending: Vec::new(),
            scratch: Vec::new(),
            edit,
            priming,
            skip: 0,
            left: None,
            hold,
            held: Vec::new(),
            ended: false,
            last: None,
        };
        let mut first = Vec::new();
        while d.channels == 0 && !d.ended {
            d.decode_packet(&mut first)?;
        }
        if d.channels == 0 {
            return Err("no audio decoded".into());
        }
        d.pending = first;
        Ok(d)
    }

    /// Moves to at most `seconds` in; the position, in seconds, of the first frame `next` then hands over.
    pub fn seek(&mut self, seconds: f64) -> Result<f64, String> {
        let time = Time::try_from_secs_f64(seconds.max(0.0)).ok_or("cannot seek: bad time")?;
        let to = SeekTo::Time { time, track_id: Some(self.track) };
        self.format.seek(SeekMode::Accurate, to).map_err(|e| format!("cannot seek: {e}"))?;
        match &mut self.codec {
            Codec::Symphonia(codec) => codec.reset(),
            Codec::Opus(o) => **o = Opus::new(o.channels)?,
        }
        // Frames held back for a webm's end padding belong to where the stream was: none of them follows the seek.
        self.pending.clear();
        self.held.clear();
        self.skip = 0;
        self.left = None;
        self.ended = false;
        self.last = None;
        // The seek's own answer is not the packet it resumes on: the first packet decoded says where it is.
        let mut first = Vec::new();
        while first.is_empty() && !self.ended {
            self.decode_packet(&mut first)?;
        }
        self.pending = first;
        let (at, trimmed) = self.last.ok_or("cannot seek: nothing decodes past it")?;
        Ok(at + trimmed as f64 / f64::from(self.sample_rate.max(1)))
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
                Ok(Some(p)) => p,
                Ok(None) => {
                    self.ended = true;
                    return Ok(());
                }
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
            if packet.track_id != self.track {
                continue;
            }
            let mut samples = std::mem::take(&mut self.scratch);
            samples.clear();
            let pts = self.time_of(packet.pts);
            let trimmed = packet.trim_start.get();
            let (rate, channels) = match &mut self.codec {
                Codec::Symphonia(codec) => match codec.decode(&packet) {
                    Ok(b) => {
                        b.copy_to_vec_interleaved(&mut samples);
                        (b.spec().rate(), b.spec().channels().count())
                    }
                    // A corrupt frame is skipped, as ffmpeg skips it, rather than failing the whole file.
                    Err(Error::DecodeError(_)) => (0, 0),
                    Err(e) => return Err(format!("cannot decode: {e}")),
                },
                Codec::Opus(o) => match (o.channels, o.decode(&packet.data)) {
                    (ch, Ok(s)) => {
                        // Opus is trimmed here, packet by packet: no decoder of symphonia's applies the container's trims.
                        let frames = s.len() / ch;
                        let head = (packet.trim_start.get() as usize).min(frames);
                        let tail = (packet.trim_end.get() as usize).min(frames - head);
                        samples.extend_from_slice(&s[head * ch..(frames - tail) * ch]);
                        (opus::RATE, ch)
                    }
                    (_, Err(_)) => (0, 0),
                },
            };
            if channels == 0 {
                self.scratch = samples;
                continue;
            }
            self.last = pts.map(|t| (t, trimmed));
            if self.channels == 0 {
                if channels > MAX_CHANNELS || rate == 0 || rate > MAX_SAMPLE_RATE {
                    return Err(format!("implausible stream ({channels} channel(s) at {rate} Hz)"));
                }
                self.channels = channels;
                self.sample_rate = rate;
                (self.skip, self.left) = self.edit.map_or((0, None), |e| e.frames(rate));
                self.skip += self.priming;
            } else if channels != self.channels || rate != self.sample_rate {
                return Err("the stream changes its channels or rate midway".into());
            }
            self.emit(out, &samples);
            self.scratch = samples;
            return Ok(());
        }
    }

    /// A timestamp of the track in seconds, when the track states its time base.
    fn time_of(&self, ts: symphonia::core::units::Timestamp) -> Option<f64> {
        let base = self.format.tracks().iter().find(|t| t.id == self.track)?.time_base?;
        Some(base.calc_time(ts)?.as_secs_f64())
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
        let kept = &samples[from..from + take as usize * ch];
        if self.hold == 0 {
            out.extend_from_slice(kept);
            return;
        }
        self.held.extend_from_slice(kept);
        let ready = self.held.len().saturating_sub(self.hold as usize * ch);
        out.extend(self.held.drain(..ready));
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
    fn seeks_to_a_frame_it_can_name() {
        let mut d = Decoder::open(Box::new(Cursor::new(wav(8000, 2, 8000))), "wav").unwrap();
        let at = d.seek(0.5).unwrap();
        assert!(at <= 0.5 && at > 0.4, "{at}");
        let mut out = Vec::new();
        d.next(&mut out, 16).unwrap();
        let frame = (at * 8000.0).round() as u32;
        assert_eq!(out[0], ((frame % 100) as f32) / 32768.0);
        assert_eq!(out[1], (((frame + 1) % 100) as f32) / 32768.0);
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
