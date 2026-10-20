# Measuring an audio file

A `{file}.cache` sidecar carries a peak/RMS envelope, three colour bands, onsets and a tempo, and
this package is the only thing that writes one. It also measures a file's true peak. Both start
from the same decode.

## One producer, three decoders

The arithmetic lives here once. What varies is where the samples come from:

- **The engine's `--decode`** on a machine that has an engine — the musician's, the standalone app.
  It decodes any format JUCE reads, it is already installed, and the musician's machine has no
  ffmpeg to rely on.
- **ffmpeg** where there is no engine — k7's backend, which is hosted. The engine is never in that image and
  never will be: it is an instrument on a musician's machine. But it holds the médiathèque's bytes, so the
  analysis of a freshly uploaded song has to happen where the bytes are. ffmpeg is already in the
  image for the rehearsal recorder's takes.
- **WebAssembly** where there is neither — the Android app, whose engine is a library inside the
  app rather than a binary to spawn, and which carries no ffmpeg (`engine/k7-runtime/docs/android.md`).
  See [the WebAssembly decoder](#the-webassembly-decoder) below.

`DecodeOptions.engineBin` picks the engine, and a missing ffmpeg falls through to WebAssembly unless
`wasm: false` says not to. Nothing downstream knows which ran: all three hand
over interleaved float32 frames at the file's own rate, every channel. On wav and flac the three
produce identical sidecars, measured. On mp3 they do not: ffmpeg trims the encoder delay and JUCE
does not, so the engine's decode is longer by it — 1105 samples, 25 ms, on the file measured in
`packages/stem-separation/docs/stemSplit.md` — and its onsets sit that much later. The fingerprint
cannot tell the two apart, so a sidecar from either is read as fresh by the other.

`--decode` prints one JSON line — `{"sampleRate":…,"channels":…,"frames":…}` — then the frames as
interleaved float32, little-endian. The header travels in the stream because the engine has no
ffprobe to ask beforehand. The `frames` it states is not trusted for geometry: frames are counted
as they arrive, the same as on the ffmpeg path.

## The WebAssembly decoder

It is [symphonia](https://github.com/pdeljanov/Symphonia), built into the same module as the
measure (`rust/src/decode.rs`, behind the crate's `decode` feature, which only the WebAssembly
build turns on, so the iOS addon does not carry it). A pure-Rust decoder was chosen over Android's
own MediaCodec because it is one path on every host, testable on a dev machine against ffmpeg, with
no native build per platform.

- **Formats:** wav, aiff, flac, mp3, ogg vorbis, AAC-LC and ALAC in mp4/m4a — and in a camera's mp4
  or .mov, whose sound is the AAC beside the picture. **Not** Opus, HE-AAC,
  webm or mkv: those fail with "unsupported", which marks the file rather than
  stopping a sweep.
- **It matches ffmpeg's positions.** Gapless is on, so mp3's encoder delay is trimmed as ffmpeg
  trims it. symphonia reads an mp4's edit list without trimming by it, and that edit list is the only
  place AAC's priming is stated, so `rust/src/edit.rs` reads it and the decoder drops and cuts by it.
  `decodeWasm.test.ts` holds flac, mp3 and m4a to ffmpeg's frame count and to 1e-4 per sample.
- **Values agree, bytes may not.** wav and flac sidecars are byte-identical to ffmpeg's; mp3 and AAC
  agree to ~1e-6, so a sidecar's last digits can differ. Vorbis is clamped to ±1 where ffmpeg lets
  an over through: peaks above full scale read 1.0. The fingerprint cannot tell, as with the engine.
- **The file is not handed over.** The module imports one function, `host.read(ptr, len, pos)`,
  which `decodeWasm.ts` answers with `fs.readSync`; a two-hour flac is never held whole.
  Decoding is synchronous inside the module, so `decodeWasm.ts` takes 64k frames at a time and
  lets the event loop through between them.
- **It costs about a megabyte.** The module grows from 24 KB to ~1 MB, checked in as base64 in
  `src/waveformWasm.generated.ts`, which biome is told to skip.

## The mono sum is the first two channels averaged

The sidecar is built from one mono signal: the first one or two channels averaged, every channel
past the second ignored. Never ffmpeg's `-ac 1`, which applies a downmix matrix that weights a centre
channel. And no `-ar`: resampling would move every onset off the position the file has.

## Frames come from the decode, not from a header

A bucket boundary is arithmetic on the total frame count, and ffprobe reports a duration that
containers round. The mono signal is therefore accumulated in chunks and measured after, which
costs one float per frame — about 57 MB for five minutes — and is what keeps the geometry exact.
It is also why the file service decodes only a few files at once.

And why a decode for the envelope is **capped**: `MAX_DECODE_FRAMES`, two hours at 48 kHz, about
1.4 GB. The cap is in frames rather than seconds because frames are what is held. It is checked
three times, since none alone suffices: against the length ffprobe claims before ffmpeg starts,
against the `frames` of the engine's header, and against the frames actually counted, which is the
one a lying header cannot get past, and the only one on the WebAssembly path. Past it the decode is killed with a `TooLongError`. The
true-peak measurement and the extraction stream what they read, hold nothing, and are not capped.

## ffmpeg opens files, not URLs

Every ffmpeg and ffprobe here runs with `-protocol_whitelist file,pipe`, before `-i`. A playlist or
a crafted container can name another resource, and the decoder of an uploaded file must never be
the thing that fetches one. The rule is the whole repo's, and its inputs are built by
`@studio/ffmpeg` (`packages/ffmpeg/docs/ffmpeg.md`).

## The version is a gate

`CACHE_VERSION` is REQUIRED on read: an older sidecar has a matching fingerprint and would otherwise
read as fresh for ever, missing whatever the bump added. v2 added `transients` + `sensitivity`, v3
`bpm`, v4 the three band envelopes. Any change to a constant in `envelope.ts` changes what a sidecar
says, so it bumps the version too.

The fingerprint — FNV-1a/64 over the size, then the first and last 64 KB — is what every reader
checks to decide whether a sidecar still describes the bytes beside it. It reads at most 128 KB
whatever the file's length, and it depends on content, not mtime, so a sidecar that travels with
its file stays valid. Changing it marks every sidecar on every disk stale at once.

## Three bands, for colour

The envelope is also split into low / mid / high peaks in the same bucket space, so a consumer
indexes all four arrays the same way. The corners are 200 Hz and 4 kHz: 200 keeps kick and bass on
one side, 4 k puts cymbals and the top of a hi-hat on the other, and what is left in the middle is
where voices and snares live.

A drawing does not need steep filters — it needs the three to be COMPLEMENTARY, which two one-pole
followers are by construction: `low + mid + high` sums back to the signal exactly, so a column's
colour cannot invent energy the audio does not have. Their state is carried across decode chunks,
or each band would restart at every chunk. Peaks and not RMS per band, for the same reason the main
envelope uses them: a kick is an attack, and averaging it over a bucket loses the thing being drawn.

## The tempo, and the prior that makes it usable

The tempo is autocorrelation over a **second** envelope, at a fixed hop and therefore a fixed rate,
built in the same pass. The stored envelope is capped at 8192 buckets so a long file coarsens —
right for drawing, useless for finding a beat, since a five-minute track lands at ~27 Hz and a beat
would be a dozen samples wide. The fixed one stays at `sampleRate / 256` whatever the length:
~187 Hz at 48 kHz. It is a half-wave-rectified first difference, because a beat is where energy
RISES; the raw envelope would correlate a sustained note with itself and report its length as the
tempo.

Correlation is then weighted by a Gaussian in log2-tempo centred on 120 bpm, sigma one octave —
Ellis's weighting. **A PRIOR, not a fold**, and the difference is measured:

- Hard-folding into a "tempo people tap" window (80–160) reports **174 as 87** and **75 as 150**. It
  breaks both of the cases it is meant to help.
- With no weighting at all, raw autocorrelation reports **140 as 70**: for a periodic signal the
  double lag correlates about as well, since every second beat lands on it.
- The prior settles that by preference rather than by decree, so a tempo far from 120 can still win
  if the audio insists.

What it does NOT fix is the far end: 174 still reads 87, because one octave out the prior favours
87 and nothing in an autocorrelation can tell a genre apart. That is a known limit of this class of
detector, acceptable here only because the number is a STARTING POINT the person edits in
`song.yaml`.

The winning lag is parabolically interpolated, which is not a refinement: at 187 Hz a whole-sample
lag is about 1 bpm at 120, and a tempo reading 119 when it is 120 drifts every grid derived from it.

`0` means none was found — silence, one sustained note, free time — and is never a guess.

## Onsets, once per file

`detectTransients` is `@studio/audio-probe`'s, called here rather than copied. `sensitivity` is its
threshold in standard deviations above the mean envelope jump; omitted, it is **2**. It is written
into the sidecar beside the onsets it produced, so the setting is per source and survives until
something asks for a different one.

Onsets are stored in FILE SECONDS and detected here, once, at the file's own envelope resolution —
not per clip region, which resamples a short clip's envelope UP and makes the same audio disagree
with itself at two zoom levels.

## The true peak is its own measurement

`measureFilePeak` answers the loudest sample on ANY channel, which is what a COLD module's `Peak` is
set from (`packages/audio-passes/docs/peakPass.md`). The sidecar cannot answer it: its envelope is
the mono sum, so a peak living on one channel of a pair reads 6 dB low there, and two channels in
anti-phase read as **silence**. It is also stored at four decimals. Right for drawing, useless for
setting a gain.

It keeps a running max and nothing else, so it holds one decoded chunk whatever the file's length.
Silence reports `PEAK_FLOOR_DB`, the same floor the `Peak` param declares, rather than negative
infinity. A float file over full scale is reported as measured: rounding here would be a policy
that belongs to the module.

## A video's sound, written out — and here the decoders swap order

`extractSound` (`src/extract.ts`) writes a file's first audio stream to a 32-bit float WAV at its
own rate and channel count, for the engine to play a shot's sound from
(`packages/song/docs/videoSound.md`). It is the one reader here that asks **ffmpeg first** and
the engine second, because what it reads is video: the engine opens a container only through the
platform's decoder, which reads no WebM on any platform and nothing at all on Linux. The engine is
the fallback for a desktop with no ffmpeg, and there it reads an `.mp4` or a `.mov`.

A file with no audio stream answers `null` rather than throwing: a silent film is not a fault.
The WAV is written to `<dest>.part` and renamed when the decode finished, so an interrupted
extraction leaves nothing a compile would take for a sound.

## No `node:` in @studio/audio-probe, and that is why this package exists

`audio-probe` MEASURES audio a caller already decoded, which is why a browser may import it. This
package spawns processes and writes files. Keeping them apart is what stops k7's clip panel from
pulling a decoder into the bundle.

## The measure runs in Rust, and writes the same bytes

The pass over every sample — the mono sum, peak/RMS, the three bands, the tempo onset envelope —
and the tempo's autocorrelation run in `rust/` where the runtime has a build of it: WebAssembly
(`src/waveformWasm.generated.ts`, checked in, since the file service loads this package as raw
TypeScript) wherever there is a JIT, and on iOS, whose V8 has none and so no WebAssembly either,
the app's Node-API addon (`packages/k7x/rust/node`, the one native library the app loads,
`K7X_ADDON`). `src/envelope.ts` stays the reference and the fallback, and `STUDIO_WAVEFORM=js`
forces it.

The two must write the same sidecar, or a decode on one host would rewrite every cache another
made — so nothing that could differ is computed twice. The followers' coefficients and the tempo
prior use `Math.exp`/`Math.log2`, so they stay in JS and are handed over; what crosses into Rust
is arithmetic IEEE 754 defines exactly (adds, multiplies, divisions, `sqrt`, comparisons), done in
the same order, with every value rounded to `f32` where `envelope.ts` stores it in a
`Float32Array`. The sidecar's text stays in `sidecar.ts`: Rust's `{:.4}` rounds an exact tie to
even where `toFixed` rounds it up, and a peak of exactly 1/32 is such a tie. `src/native.test.ts`
holds every array bit for bit and every sidecar byte for byte, through both builds, so
`CACHE_VERSION` did not move.

A WebAssembly instance is made per file and dropped after it: the mono signal is held inside it
until the measure, and a two-hour file grows that memory past a gigabyte, which an instance never
gives back. The module itself is compiled once.

Measured on five minutes of 48 kHz stereo (`npm run bench:measure -w @studio/audio-analysis`,
Windows, x86-64, node 24.18): with a JIT, 213 ms in JS, 113 ms in WebAssembly, 91 ms through the
addon; without one, as on iOS, 3,418 ms in JS against 92 ms through the addon. The decode is not
in those numbers, and on a phone it is the engine's.
