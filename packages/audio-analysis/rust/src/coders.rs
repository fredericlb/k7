// coders.rs — the three outputs: Opus in WebM, FLAC and 16-bit WAV, each taking interleaved f32 frames at its own rate.
// A reader would get wrong the Opus length: the encoder's lookahead is the pre-skip, so silence is fed past the end and stated as padding.

use crate::sink::Sink;
use crate::webm_write::WebmOpus;
use flacenc::bitsink::ByteSink;
use flacenc::component::{BitRepr, Stream};
use flacenc::config;
use flacenc::error::{Verified, Verify};
use flacenc::source::{Context, Fill, FrameBuf};

pub trait Coder {
    fn push(&mut self, frames: &[f32]) -> Result<(), String>;
    /// Writes what is held and patches the head; the frames the output holds.
    fn finish(self: Box<Self>) -> Result<u64, String>;
}

/// 20 ms at 48 kHz: the frame every Opus packet here carries.
const OPUS_FRAME: usize = 960;
/// The encoder's lookahead at 48 kHz in the Audio application: 2.5 ms plus its 4 ms delay compensation.
pub const OPUS_PRE_SKIP: u16 = 312;

pub struct OpusWebm<S: Sink> {
    enc: opus_rs::OpusEncoder,
    webm: Option<WebmOpus<S>>,
    channels: usize,
    pending: Vec<f32>,
    packet: Vec<u8>,
    frames_in: u64,
    packets: u64,
}

impl<S: Sink> OpusWebm<S> {
    pub fn new(sink: S, channels: usize, bitrate: i32, input_rate: u32) -> Result<Self, String> {
        let mut enc = opus_rs::OpusEncoder::new(48_000, channels, opus_rs::Application::Audio)
            .map_err(|e| format!("cannot encode Opus: {e}"))?;
        enc.bitrate_bps = bitrate;
        enc.complexity = 10;
        let webm = WebmOpus::new(sink, channels as u8, OPUS_PRE_SKIP, input_rate)?;
        Ok(OpusWebm { enc, webm: Some(webm), channels, pending: Vec::new(), packet: vec![0; 4000], frames_in: 0, packets: 0 })
    }

    fn encode_ready(&mut self) -> Result<(), String> {
        let n = OPUS_FRAME * self.channels;
        let mut used = 0;
        while self.pending.len() - used >= n {
            let len = self
                .enc
                .encode(&self.pending[used..used + n], OPUS_FRAME, &mut self.packet)
                .map_err(|e| format!("cannot encode Opus: {e}"))?;
            let webm = self.webm.as_mut().ok_or("the WebM is already finished")?;
            webm.packet(self.packets * 20, &self.packet[..len])?;
            self.packets += 1;
            used += n;
        }
        self.pending.drain(..used);
        Ok(())
    }
}

impl<S: Sink> Coder for OpusWebm<S> {
    fn push(&mut self, frames: &[f32]) -> Result<(), String> {
        self.frames_in += (frames.len() / self.channels) as u64;
        self.pending.extend_from_slice(frames);
        self.encode_ready()
    }

    fn finish(mut self: Box<Self>) -> Result<u64, String> {
        // Enough silence for the lookahead to bring the last real frame out, then up to a whole packet.
        let total = self.frames_in + u64::from(OPUS_PRE_SKIP);
        let packets = total.div_ceil(OPUS_FRAME as u64).max(1);
        let pad = packets * OPUS_FRAME as u64 - self.frames_in;
        self.pending.resize(self.pending.len() + pad as usize * self.channels, 0.0);
        self.encode_ready()?;
        let discard = packets * OPUS_FRAME as u64 - total;
        let webm = self.webm.take().ok_or("the WebM is already finished")?;
        webm.finish(discard, self.frames_in as f64 * 1000.0 / 48_000.0)?;
        Ok(self.frames_in)
    }
}

/// Frames per FLAC block, the reference encoder's default.
const FLAC_BLOCK: usize = 4096;

pub struct Flac<S: Sink> {
    sink: S,
    config: Verified<config::Encoder>,
    stream: Stream,
    frame: FrameBuf,
    context: Context,
    channels: usize,
    bits: usize,
    pending: Vec<i32>,
    pos: u64,
}

impl<S: Sink> Flac<S> {
    pub fn new(sink: S, rate: u32, channels: usize, bits: usize) -> Result<Self, String> {
        let config = config::Encoder::default().into_verified().map_err(|(_, e)| e.to_string())?;
        let mut stream = Stream::new(rate as usize, channels, bits).map_err(|e| e.to_string())?;
        stream.stream_info_mut().set_block_sizes(FLAC_BLOCK, FLAC_BLOCK).map_err(|e| e.to_string())?;
        let frame = FrameBuf::with_size(channels, FLAC_BLOCK).map_err(|e| e.to_string())?;
        let mut flac = Flac {
            sink,
            config,
            stream,
            frame,
            context: Context::new(bits, channels),
            channels,
            bits,
            pending: Vec::new(),
            pos: 0,
        };
        flac.pos = flac.write_head()?;
        Ok(flac)
    }

    /// `fLaC` and the STREAMINFO block, the same length before and after the frames: written first, then again.
    fn write_head(&mut self) -> Result<u64, String> {
        let mut head = ByteSink::new();
        self.stream.write(&mut head).map_err(|e| e.to_string())?;
        self.sink.write_at(0, head.as_slice())?;
        Ok(head.as_slice().len() as u64)
    }

    fn encode(&mut self, samples: &[i32]) -> Result<(), String> {
        (&mut self.frame, &mut self.context).fill_interleaved(samples).map_err(|e| e.to_string())?;
        let number = self.context.current_frame_number().unwrap_or(0);
        let frame = flacenc::encode_fixed_size_frame(&self.config, &self.frame, number, self.stream.stream_info())
            .map_err(|e| e.to_string())?;
        self.stream.stream_info_mut().update_frame_info(&frame);
        let mut bytes = ByteSink::new();
        frame.write(&mut bytes).map_err(|e| e.to_string())?;
        self.sink.write_at(self.pos, bytes.as_slice())?;
        self.pos += bytes.as_slice().len() as u64;
        Ok(())
    }
}

impl<S: Sink> Coder for Flac<S> {
    fn push(&mut self, frames: &[f32]) -> Result<(), String> {
        let top = ((1i64 << (self.bits - 1)) - 1) as f32;
        self.pending.extend(frames.iter().map(|&s| (s * top).round().clamp(-top - 1.0, top) as i32));
        let block = FLAC_BLOCK * self.channels;
        while self.pending.len() >= block {
            let rest = self.pending.split_off(block);
            let full = std::mem::replace(&mut self.pending, rest);
            self.encode(&full)?;
        }
        Ok(())
    }

    fn finish(mut self: Box<Self>) -> Result<u64, String> {
        if !self.pending.is_empty() {
            let last = std::mem::take(&mut self.pending);
            self.encode(&last)?;
        }
        let total = self.context.total_samples();
        let md5 = self.context.md5_digest();
        let info = self.stream.stream_info_mut();
        info.set_md5_digest(&md5);
        info.set_total_samples(total);
        // The last block is short, and STREAMINFO's minimum must not count it: min ≠ max reads as variable block size.
        let block = FLAC_BLOCK.min(total.max(1));
        info.set_block_sizes(block, block).map_err(|e| e.to_string())?;
        self.write_head()?;
        Ok(total as u64)
    }
}

/// A 16-bit PCM WAV: the header written with zero sizes, then patched.
pub struct Wav16<S: Sink> {
    sink: S,
    channels: usize,
    rate: u32,
    frames: u64,
    pos: u64,
}

impl<S: Sink> Wav16<S> {
    pub fn new(mut sink: S, rate: u32, channels: usize) -> Result<Self, String> {
        sink.write_at(0, &wav_header(rate, channels, 0))?;
        Ok(Wav16 { sink, channels, rate, frames: 0, pos: 44 })
    }
}

fn wav_header(rate: u32, channels: usize, frames: u64) -> Vec<u8> {
    let ch = channels as u16;
    let data = (frames * u64::from(ch) * 2) as u32;
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + data).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&ch.to_le_bytes());
    h.extend_from_slice(&rate.to_le_bytes());
    h.extend_from_slice(&(rate * u32::from(ch) * 2).to_le_bytes());
    h.extend_from_slice(&(ch * 2).to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data.to_le_bytes());
    h
}

impl<S: Sink> Coder for Wav16<S> {
    fn push(&mut self, frames: &[f32]) -> Result<(), String> {
        let bytes: Vec<u8> = frames
            .iter()
            .flat_map(|&s| ((s * 32767.0).round().clamp(-32768.0, 32767.0) as i16).to_le_bytes())
            .collect();
        self.sink.write_at(self.pos, &bytes)?;
        self.pos += bytes.len() as u64;
        self.frames += (frames.len() / self.channels) as u64;
        Ok(())
    }

    fn finish(mut self: Box<Self>) -> Result<u64, String> {
        self.sink.write_at(0, &wav_header(self.rate, self.channels, self.frames))?;
        Ok(self.frames)
    }
}
