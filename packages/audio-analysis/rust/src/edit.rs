// edit.rs — an mp4's edit list for its sound track: where the audio really starts and how long it lasts.
// A reader would get wrong why this exists: symphonia reads `elst` but does not trim by it, and AAC's priming is only there.

use std::io::{Read, Seek, SeekFrom};

/// The first non-empty edit of the sound track: its start in the track's timescale, its length in the movie's.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Edit {
    pub media_time: u64,
    pub track_scale: u32,
    pub duration: u64,
    pub movie_scale: u32,
}

impl Edit {
    /// Frames to drop at the start and frames to keep after them, at `rate`.
    pub fn frames(&self, rate: u32) -> (u64, Option<u64>) {
        let at = |v: u64, scale: u32| (v as u128 * u128::from(rate) / u128::from(scale.max(1))) as u64;
        let keep = (self.duration > 0).then(|| at(self.duration, self.movie_scale));
        (at(self.media_time, self.track_scale), keep)
    }
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

fn u64_at(b: &[u8], i: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(i..i + 8)?.try_into().ok()?))
}

/// A full box's timescale, after its version, flags and two dates of 4 or 8 bytes.
fn timescale(b: &[u8]) -> Option<u32> {
    u32_at(b, if *b.first()? == 1 { 20 } else { 12 })
}

/// The children of a box body, as (type, body).
fn children(b: &[u8]) -> Vec<(&[u8], &[u8])> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(size) = u32_at(b, i) {
        let (head, len) = match size {
            1 => (16, u64_at(b, i + 8).unwrap_or(0) as usize),
            0 => (8, b.len() - i),
            n => (8, n as usize),
        };
        if len < head || i + len > b.len() {
            break;
        }
        out.push((&b[i + 4..i + 8], &b[i + head..i + len]));
        i += len;
    }
    out
}

fn child<'a>(b: &'a [u8], kind: &[u8]) -> Option<&'a [u8]> {
    children(b).into_iter().find(|(k, _)| *k == kind).map(|(_, v)| v)
}

/// The edit of the first sound track of an `moov` body, when it has one.
fn from_moov(moov: &[u8]) -> Option<Edit> {
    let movie_scale = timescale(child(moov, b"mvhd")?)?;
    for (kind, trak) in children(moov) {
        if kind != b"trak" {
            continue;
        }
        let Some(mdia) = child(trak, b"mdia") else { continue };
        if child(mdia, b"hdlr").and_then(|h| h.get(8..12)) != Some(b"soun") {
            continue;
        }
        let track_scale = timescale(child(mdia, b"mdhd")?)?;
        let elst = child(child(trak, b"edts")?, b"elst")?;
        let wide = *elst.first()? == 1;
        let count = u32_at(elst, 4)? as usize;
        let size = if wide { 20 } else { 12 };
        for e in 0..count.min(64) {
            let at = 8 + e * size;
            let (duration, media_time) = if wide {
                (u64_at(elst, at)?, u64_at(elst, at + 8)? as i64)
            } else {
                (u64::from(u32_at(elst, at)?), i64::from(u32_at(elst, at + 4)? as i32))
            };
            // An empty edit (-1) is a pause before the sound, which ffmpeg does not insert either.
            if media_time >= 0 {
                return Some(Edit { media_time: media_time as u64, track_scale, duration, movie_scale });
            }
        }
        return None;
    }
    None
}

/// The sound track's edit when `src` is an mp4 that has one; `src` is left wherever the walk stopped.
pub fn read_edit<R: Read + Seek + ?Sized>(src: &mut R) -> Option<Edit> {
    // An moov is a few hundred kilobytes for hours of audio; past this it is not one worth trusting.
    const MAX_MOOV: u64 = 64 << 20;
    let mut first = true;
    loop {
        let mut head = [0u8; 8];
        src.read_exact(&mut head).ok()?;
        let kind = [head[4], head[5], head[6], head[7]];
        if first && &kind != b"ftyp" {
            return None;
        }
        first = false;
        let mut len = u64::from(u32::from_be_bytes([head[0], head[1], head[2], head[3]]));
        let mut header = 8;
        if len == 1 {
            let mut wide = [0u8; 8];
            src.read_exact(&mut wide).ok()?;
            len = u64::from_be_bytes(wide);
            header = 16;
        }
        if len == 0 || len < header {
            return None;
        }
        if &kind == b"moov" {
            if len - header > MAX_MOOV {
                return None;
            }
            let mut body = vec![0u8; (len - header) as usize];
            src.read_exact(&mut body).ok()?;
            return from_moov(&body);
        }
        src.seek(SeekFrom::Current((len - header) as i64)).ok()?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn boxed(kind: &[u8], body: &[u8]) -> Vec<u8> {
        let mut b = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        b.extend_from_slice(kind);
        b.extend_from_slice(body);
        b
    }

    fn scale_box(kind: &[u8], scale: u32) -> Vec<u8> {
        let mut body = vec![0u8; 12];
        body.extend_from_slice(&scale.to_be_bytes());
        body.extend_from_slice(&[0u8; 8]);
        boxed(kind, &body)
    }

    fn mp4(handler: &[u8], edits: &[(u32, i32)]) -> Vec<u8> {
        let mut hdlr = vec![0u8; 8];
        hdlr.extend_from_slice(handler);
        hdlr.extend_from_slice(&[0u8; 12]);
        let mdia = [scale_box(b"mdhd", 44_100), boxed(b"hdlr", &hdlr)].concat();
        let mut elst = vec![0u8; 4];
        elst.extend_from_slice(&(edits.len() as u32).to_be_bytes());
        for (d, t) in edits {
            elst.extend_from_slice(&d.to_be_bytes());
            elst.extend_from_slice(&t.to_be_bytes());
            elst.extend_from_slice(&[0, 1, 0, 0]);
        }
        let trak = [boxed(b"edts", &boxed(b"elst", &elst)), boxed(b"mdia", &mdia)].concat();
        let moov = [scale_box(b"mvhd", 1000), boxed(b"trak", &trak)].concat();
        [boxed(b"ftyp", b"M4A \0\0\0\0"), boxed(b"mdat", &[7u8; 100]), boxed(b"moov", &moov)].concat()
    }

    #[test]
    fn reads_the_priming_and_the_length_of_the_sound_track() {
        let edit = read_edit(&mut Cursor::new(mp4(b"soun", &[(-1i32 as u32, -1), (30_000, 1024)]))).unwrap();
        assert_eq!(edit.frames(44_100), (1024, Some(1_323_000)));
    }

    #[test]
    fn ignores_what_is_not_an_mp4_sound_track() {
        assert_eq!(read_edit(&mut Cursor::new(mp4(b"vide", &[(30_000, 1024)]))), None);
        assert_eq!(read_edit(&mut Cursor::new(b"RIFF\0\0\0\0WAVE".to_vec())), None);
    }
}
