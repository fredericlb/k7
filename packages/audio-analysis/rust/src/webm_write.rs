// webm_write.rs — one Opus track written as a WebM: header, a cluster every five seconds, cues, then the sizes patched in.
// A reader would get wrong the order: the head is written first with placeholders, and `finish` goes back to it (docs/transcode.md).

use crate::sink::Sink;

const EBML: u32 = 0x1A45_DFA3;
const SEGMENT: u32 = 0x1853_8067;
const SEEK_HEAD: u32 = 0x114D_9B74;
const SEEK: u32 = 0x4DBB;
const SEEK_ID: u32 = 0x53AB;
const SEEK_POSITION: u32 = 0x53AC;
const INFO: u32 = 0x1549_A966;
const TRACKS: u32 = 0x1654_AE6B;
const CUES: u32 = 0x1C53_BB6B;
const CLUSTER: u32 = 0x1F43_B675;

/// Milliseconds per cluster: short enough for a block's 16-bit relative timestamp, long enough to stay few.
const CLUSTER_MS: u64 = 5000;

/// An element: its ID's bytes, the shortest size vint, then the body.
fn element(id: u32, body: &[u8], out: &mut Vec<u8>) {
    let id_bytes = id.to_be_bytes();
    let skip = id_bytes.iter().take_while(|&&b| b == 0).count();
    out.extend_from_slice(&id_bytes[skip..]);
    size(body.len() as u64, out);
    out.extend_from_slice(body);
}

/// The shortest EBML size vint for `n`.
fn size(n: u64, out: &mut Vec<u8>) {
    let mut len = 1;
    while len < 8 && n >= (1u64 << (7 * len)) - 1 {
        len += 1;
    }
    let marked = n | (1u64 << (7 * len));
    out.extend_from_slice(&marked.to_be_bytes()[8 - len..]);
}

fn uint(id: u32, v: u64, out: &mut Vec<u8>) {
    let b = v.to_be_bytes();
    let skip = b.iter().take_while(|&&x| x == 0).count().min(7);
    element(id, &b[skip..], out);
}

/// A signed integer in the fewest bytes whose first bit still carries its sign.
fn sint(id: u32, v: i64, out: &mut Vec<u8>) {
    let b = v.to_be_bytes();
    let mut skip = 0;
    while skip < 7 && ((b[skip] == 0 && b[skip + 1] & 0x80 == 0) || (b[skip] == 0xff && b[skip + 1] & 0x80 != 0)) {
        skip += 1;
    }
    element(id, &b[skip..], out);
}

fn float(id: u32, v: f64, out: &mut Vec<u8>) {
    element(id, &v.to_be_bytes(), out);
}

fn text(id: u32, v: &str, out: &mut Vec<u8>) {
    element(id, v.as_bytes(), out);
}

/// A size vint of exactly eight bytes, so it can be overwritten once the size is known.
fn size8(n: u64) -> [u8; 8] {
    (n | (1u64 << 56)).to_be_bytes()
}

pub struct WebmOpus<S: Sink> {
    sink: S,
    pos: u64,
    /// Where the Segment's size, the Duration and the Cues' SeekPosition sit, to be patched.
    segment_size_at: u64,
    segment_start: u64,
    duration_at: u64,
    cues_seek_at: u64,
    cluster: Vec<u8>,
    cluster_ms: u64,
    cluster_at: Vec<(u64, u64)>,
    held: Option<(u64, Vec<u8>)>,
}

impl<S: Sink> WebmOpus<S> {
    /// The head: EBML header, then the Segment with its SeekHead, Info and Tracks, sizes and duration left to patch.
    pub fn new(mut sink: S, channels: u8, pre_skip: u16, input_rate: u32) -> Result<Self, String> {
        let mut head = Vec::new();
        let mut ebml = Vec::new();
        uint(0x4286, 1, &mut ebml);
        uint(0x42F7, 1, &mut ebml);
        uint(0x42F2, 4, &mut ebml);
        uint(0x42F3, 8, &mut ebml);
        text(0x4282, "webm", &mut ebml);
        uint(0x4287, 4, &mut ebml);
        uint(0x4285, 2, &mut ebml);
        element(EBML, &ebml, &mut head);
        head.extend_from_slice(&SEGMENT.to_be_bytes());
        let segment_size_at = head.len() as u64;
        head.extend_from_slice(&size8(0));
        let segment_start = head.len() as u64;

        // Duration LAST in Info, so its eight bytes end the element and are found from its end.
        let mut info = Vec::new();
        uint(0x2A_D7B1, 1_000_000, &mut info);
        text(0x4D80, "k7", &mut info);
        text(0x5741, "k7", &mut info);
        float(0x4489, 0.0, &mut info);

        let mut opus_head = b"OpusHead".to_vec();
        opus_head.push(1);
        opus_head.push(channels);
        opus_head.extend_from_slice(&pre_skip.to_le_bytes());
        opus_head.extend_from_slice(&input_rate.to_le_bytes());
        opus_head.extend_from_slice(&[0, 0, 0]);
        let mut audio = Vec::new();
        float(0xB5, 48_000.0, &mut audio);
        uint(0x9F, u64::from(channels), &mut audio);
        let mut entry = Vec::new();
        uint(0xD7, 1, &mut entry);
        uint(0x73C5, 1, &mut entry);
        uint(0x83, 2, &mut entry);
        text(0x86, "A_OPUS", &mut entry);
        element(0x63A2, &opus_head, &mut entry);
        uint(0x56AA, u64::from(pre_skip) * 1_000_000_000 / 48_000, &mut entry);
        uint(0x56BB, 80_000_000, &mut entry);
        element(0xE1, &audio, &mut entry);
        let mut tracks = Vec::new();
        element(0xAE, &entry, &mut tracks);

        // The SeekHead names Info and Tracks where they land, and Cues LAST, its position the element's final eight bytes.
        let seek = |id: u32, at: u64, out: &mut Vec<u8>| {
            let mut s = Vec::new();
            element(SEEK_ID, &id.to_be_bytes(), &mut s);
            element(SEEK_POSITION, &at.to_be_bytes(), &mut s);
            element(SEEK, &s, out);
        };
        let mut info_el = Vec::new();
        element(INFO, &info, &mut info_el);
        // Every position is eight bytes, so a SeekHead of zeros is exactly as long as the real one.
        let mut probe = Vec::new();
        for id in [INFO, TRACKS, CUES] {
            seek(id, 0, &mut probe);
        }
        let mut seek_head = Vec::new();
        element(SEEK_HEAD, &probe, &mut seek_head);
        let info_at = seek_head.len() as u64;
        let tracks_at = info_at + info_el.len() as u64;
        let mut seeks = Vec::new();
        seek(INFO, info_at, &mut seeks);
        seek(TRACKS, tracks_at, &mut seeks);
        seek(CUES, 0, &mut seeks);
        element(SEEK_HEAD, &seeks, &mut head);
        let cues_seek_at = head.len() as u64 - 8;
        head.extend_from_slice(&info_el);
        let duration_at = head.len() as u64 - 8;
        element(TRACKS, &tracks, &mut head);

        sink.write_at(0, &head)?;
        Ok(WebmOpus {
            sink,
            pos: head.len() as u64,
            segment_size_at,
            segment_start,
            duration_at,
            cues_seek_at,
            cluster: Vec::new(),
            cluster_ms: 0,
            cluster_at: Vec::new(),
            held: None,
        })
    }

    /// One packet starting `ms` after the stream's start; held back one packet, so the last can carry the padding.
    pub fn packet(&mut self, ms: u64, data: &[u8]) -> Result<(), String> {
        if let Some((at, prev)) = self.held.take() {
            self.block(at, &prev, None)?;
        }
        self.held = Some((ms, data.to_vec()));
        Ok(())
    }

    fn block(&mut self, ms: u64, data: &[u8], discard_ns: Option<u64>) -> Result<(), String> {
        if self.cluster.is_empty() || ms - self.cluster_ms >= CLUSTER_MS {
            self.flush_cluster()?;
            self.cluster_ms = ms;
            uint(0xE7, ms, &mut self.cluster);
        }
        let mut b = vec![0x81];
        b.extend_from_slice(&((ms - self.cluster_ms) as i16).to_be_bytes());
        match discard_ns {
            None => {
                b.push(0x80);
                b.extend_from_slice(data);
                element(0xA3, &b, &mut self.cluster);
            }
            Some(ns) => {
                b.push(0x00);
                b.extend_from_slice(data);
                let mut group = Vec::new();
                element(0xA1, &b, &mut group);
                sint(0x75A2, ns as i64, &mut group);
                element(0xA0, &group, &mut self.cluster);
            }
        }
        Ok(())
    }

    fn flush_cluster(&mut self) -> Result<(), String> {
        if self.cluster.is_empty() {
            return Ok(());
        }
        let mut el = Vec::new();
        element(CLUSTER, &self.cluster, &mut el);
        self.cluster_at.push((self.cluster_ms, self.pos - self.segment_start));
        self.sink.write_at(self.pos, &el)?;
        self.pos += el.len() as u64;
        self.cluster.clear();
        Ok(())
    }

    /// The last packet with its padding, the cues, then every size and the duration patched into the head.
    pub fn finish(mut self, discard_frames: u64, duration_ms: f64) -> Result<S, String> {
        if let Some((ms, data)) = self.held.take() {
            let ns = discard_frames * 1_000_000_000 / 48_000;
            self.block(ms, &data, (ns > 0).then_some(ns))?;
        }
        self.flush_cluster()?;
        let mut points = Vec::new();
        for &(ms, at) in &self.cluster_at {
            let mut pos = Vec::new();
            uint(0xF7, 1, &mut pos);
            uint(0xF1, at, &mut pos);
            let mut point = Vec::new();
            uint(0xB3, ms, &mut point);
            element(0xB7, &pos, &mut point);
            element(0xBB, &point, &mut points);
        }
        let mut cues = Vec::new();
        element(CUES, &points, &mut cues);
        let cues_at = self.pos - self.segment_start;
        self.sink.write_at(self.pos, &cues)?;
        self.pos += cues.len() as u64;
        self.sink.write_at(self.cues_seek_at, &cues_at.to_be_bytes())?;
        self.sink.write_at(self.duration_at, &duration_ms.to_be_bytes())?;
        self.sink.write_at(self.segment_size_at, &size8(self.pos - self.segment_start))?;
        Ok(self.sink)
    }
}
