# Re-encoding audio without ffmpeg

`transcode` (`src/transcode.ts`) decodes one file or several, joined, and writes them as Opus in
WebM, FLAC or 16-bit WAV — a rehearsal moment's cut, a splice of takes, the médiathèque's stream
copy of a FLAC, a render's stems, a transcription's input. It is the same WebAssembly module as the
decoder ([analysis.md](analysis.md)), built with the crate's `encode` feature, and services run it
on the pool's workers (`transcodeOffThread`), each job with a deadline its caller sets.

## Why not ffmpeg

ffmpeg is a 100 MB dependency of the hosted image that a crafted upload talks to, and a child that
can hang where the shared backend cannot reach it. The WebAssembly build is one path on every host —
the server, the desktop, the phone — reads only the file it is handed, through the host's reads,
and runs on a worker the pool terminates past its deadline. What ffmpeg still does here is what no
Rust crate does well: video, and an mp3 (`packages/take-render/docs/rendering.md`).

## The crates, and what each is for

- **opus-rs** encodes Opus as well as decoding it — pure Rust, within a fraction of a dB of libopus
  at 128 kbit/s. It is young; the tests here hold its output to our own decoder and to ffprobe.
- **rubato**'s FFT resampler converts every rate to Opus's 48 kHz, and a transcription's 16 kHz.
- **ebur128** measures integrated loudness and true peak, for a clip brought to a loudness.
- **flacenc** encodes FLAC.
- **The WebM writer is ours** (`rust/src/webm_write.rs`): one Opus track, a cluster every five
  seconds, cues, and the sizes patched in at the end. No pure-Rust muxer is mature, the subset one
  audio track needs is small, and `rust/src/webm.rs` already reads the format back.

## The length is exact

Every output holds exactly the frames that went in, at the output's rate — `ceil(n × ratio)` when
resampled, computed in integers since a float ratio rounds 88 200 × 48 000 / 44 100 up to 96 001.
Opus starts with the encoder's lookahead, 312 frames at 48 kHz: it is stated as the OpusHead's
pre-skip and the track's CodecDelay, silence is fed past the end until the last real frame is out,
and what is left of the last packet is its `DiscardPadding`. That value is a SIGNED integer, written
in the fewest bytes whose first bit is still a sign: written unsigned, a padding past 0x7F… reads
back negative and the decoder keeps it.

FLAC's STREAMINFO is written first and again at the end, once the MD5 and the length are known. Its
minimum block size is set back to the fixed one: flacenc counts the short last block in it, and a
stream whose minimum and maximum differ reads as variable-block-size, which symphonia refuses.

## A cut seeks, and knows where it landed

A cut deep into a long take does not decode from the start: the decoder seeks a quarter second
early, for Opus to settle, and drops what comes before the cut. Where it landed is read from the
first packet decoded after the seek — its timestamp plus what the container trims from its head —
not from the seek's own answer, which names a later packet. WebM states time in milliseconds, so a
cut there lands within one. Frames held back for a WebM's end padding are dropped on a seek: they
belong to where the stream was. A format that cannot seek is decoded from its start, slower and as
exact.

## A loudness is one gain

A clip asked to reach a loudness is measured first (one more decode), then encoded with a single
gain, lowered as far as it takes to keep its true peak under the ceiling. A join is never brought
to a loudness: its takes were recorded at their own levels, and one gain over all of them would
answer to none.

## Its tests need no ffmpeg

`transcode.test.ts` decodes what it wrote with the module's own decoder, and checks it with ffprobe
only where ffmpeg is installed, as a stand-in for what a browser will read.
