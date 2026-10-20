// webm.rs — a webm's end padding: the `DiscardPadding` of its last block group, which symphonia parses but never applies.
// A reader would get wrong how it is found: in the file's tail, as a BlockGroup whose children parse to its exact size.

use std::io::{Read, Seek, SeekFrom};

const EBML: [u8; 4] = [0x1a, 0x45, 0xdf, 0xa3];
const BLOCK_GROUP: u64 = 0xa0;
const BLOCK: u64 = 0xa1;
const DISCARD_PADDING: u64 = 0x75a2;

// The last block group sits in the final cluster, a few seconds of audio at most.
const TAIL: u64 = 256 << 10;

/// An EBML variable-length integer at `at`: its value (marker kept for an ID, stripped for a size) and its length.
fn vint(b: &[u8], at: usize, keep_marker: bool) -> Option<(u64, usize)> {
    let first = *b.get(at)?;
    let len = first.leading_zeros() as usize + 1;
    if len > 8 || at + len > b.len() {
        return None;
    }
    let mut v = u64::from(if keep_marker { first } else { first & (0xff >> len) });
    for i in 1..len {
        v = (v << 8) | u64::from(b[at + i]);
    }
    Some((v, len))
}

/// The DiscardPadding of the block group starting at `at`, when its children parse to exactly its size.
fn group_padding(b: &[u8], at: usize) -> Option<i64> {
    let (_, id_len) = vint(b, at, true)?;
    let (size, size_len) = vint(b, at + id_len, false)?;
    let start = at + id_len + size_len;
    let end = start.checked_add(usize::try_from(size).ok()?)?;
    if end > b.len() {
        return None;
    }
    let (mut i, mut block, mut padding) = (start, false, None);
    while i < end {
        let (id, l) = vint(b, i, true)?;
        let (len, m) = vint(b, i + l, false)?;
        let body = i + l + m;
        let next = body.checked_add(usize::try_from(len).ok()?)?;
        if next > end {
            return None;
        }
        match id {
            BLOCK => block = true,
            DISCARD_PADDING if (1..=8).contains(&len) => {
                // A signed big-endian integer, sign-extended from its first byte.
                let mut v = i64::from(b[body] as i8);
                for &x in &b[body + 1..next] {
                    v = (v << 8) | i64::from(x);
                }
                padding = Some(v);
            }
            _ => {}
        }
        i = next;
    }
    (i == end && block).then_some(padding).flatten()
}

/// Frames to cut from the end of an Opus stream at `rate`, when `src` is a webm that states its padding.
pub fn end_padding<R: Read + Seek + ?Sized>(src: &mut R, rate: u32) -> Option<u64> {
    let mut magic = [0u8; 4];
    src.read_exact(&mut magic).ok()?;
    if magic != EBML {
        return None;
    }
    let len = src.seek(SeekFrom::End(0)).ok()?;
    let from = len.saturating_sub(TAIL);
    src.seek(SeekFrom::Start(from)).ok()?;
    let mut tail = Vec::with_capacity((len - from) as usize);
    src.read_to_end(&mut tail).ok()?;
    let ns = (0..tail.len())
        .rev()
        .filter(|&i| u64::from(tail[i]) == BLOCK_GROUP)
        .find_map(|i| group_padding(&tail, i))?;
    (ns > 0).then(|| ((ns as u128 * u128::from(rate) + 500_000_000) / 1_000_000_000) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// An element: its ID bytes, a one-byte size, its body.
    fn el(id: &[u8], body: &[u8]) -> Vec<u8> {
        [id, &[0x80 | body.len() as u8], body].concat()
    }

    fn webm(padding_ns: &[u8]) -> Vec<u8> {
        let group = el(&[0xa0], &[el(&[0xa1], &[0x81, 0, 0, 0x80, 1, 2, 3]), el(&[0x75, 0xa2], padding_ns)].concat());
        [EBML.to_vec(), vec![0x9f; 40], vec![0xa0; 3], group].concat()
    }

    #[test]
    fn reads_the_padding_of_the_last_block_group() {
        // 13.5 ms, 648 frames at 48 kHz, as ffmpeg's libopus writes it.
        assert_eq!(end_padding(&mut Cursor::new(webm(&13_500_000u32.to_be_bytes())), 48_000), Some(648));
    }

    #[test]
    fn says_nothing_without_one() {
        assert_eq!(end_padding(&mut Cursor::new(webm(&[])), 48_000), None);
        assert_eq!(end_padding(&mut Cursor::new(b"OggS and more".to_vec()), 48_000), None);
    }
}
