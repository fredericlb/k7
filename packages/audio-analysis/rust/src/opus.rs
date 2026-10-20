// opus.rs — Opus packets to f32 frames with opus-rs, since symphonia reads Opus containers but has no Opus decoder.
// A reader would get wrong where the priming goes: Opus always starts with a pre-skip, stated by the container or the OpusHead.

/// Opus always decodes at 48 kHz, whatever rate the source was encoded from.
pub const RATE: u32 = 48_000;

/// The longest packet Opus allows: 120 ms at 48 kHz, per channel.
const MAX_FRAMES: usize = 5760;

pub struct Opus {
    decoder: opus_rs::OpusDecoder,
    out: Vec<f32>,
    pub channels: usize,
}

impl Opus {
    /// A decoder for a mono or stereo stream; a multichannel one needs the multistream decoder, which is not wired.
    pub fn new(channels: usize) -> Result<Self, String> {
        if !(1..=2).contains(&channels) {
            return Err(format!("unsupported codec: Opus with {channels} channels"));
        }
        let decoder = opus_rs::OpusDecoder::new(RATE as i32, channels).map_err(|e| format!("unsupported codec: {e}"))?;
        Ok(Opus { decoder, out: vec![0.0; MAX_FRAMES * channels], channels })
    }

    /// One packet's frames, interleaved; valid until the next call.
    pub fn decode(&mut self, packet: &[u8]) -> Result<&[f32], String> {
        let n = self.decoder.decode(packet, MAX_FRAMES, &mut self.out).map_err(|e| e.to_string())?;
        Ok(&self.out[..n * self.channels])
    }
}

/// The channel count an OpusHead states, for a container that does not.
pub fn head_channels(extra: Option<&[u8]>) -> Option<usize> {
    extra.filter(|h| h.len() >= 10 && h.starts_with(b"OpusHead")).map(|h| usize::from(h[9]))
}

/// Frames to drop at the start: the container's delay where it states one (ogg), else the OpusHead's pre-skip (webm).
pub fn pre_skip(delay: Option<u32>, extra: Option<&[u8]>) -> u64 {
    delay.map(u64::from).unwrap_or_else(|| {
        extra
            .filter(|h| h.len() >= 12 && h.starts_with(b"OpusHead"))
            .map_or(0, |h| u64::from(u16::from_le_bytes([h[10], h[11]])))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head(channels: u8, pre_skip: u16) -> Vec<u8> {
        let mut h = b"OpusHead\x01".to_vec();
        h.push(channels);
        h.extend_from_slice(&pre_skip.to_le_bytes());
        h.extend_from_slice(&48_000u32.to_le_bytes());
        h.extend_from_slice(&[0, 0, 0]);
        h
    }

    #[test]
    fn takes_the_pre_skip_from_the_container_first_then_the_head() {
        let h = head(2, 312);
        assert_eq!(pre_skip(Some(100), Some(&h)), 100);
        assert_eq!(pre_skip(None, Some(&h)), 312);
        assert_eq!(pre_skip(None, None), 0);
        assert_eq!(head_channels(Some(&h)), Some(2));
    }

    #[test]
    fn refuses_what_it_cannot_decode() {
        assert!(Opus::new(6).is_err());
        assert!(Opus::new(2).is_ok());
    }
}
