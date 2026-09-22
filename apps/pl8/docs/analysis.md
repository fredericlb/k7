# The background waveform sweep

A song draws its waveform from a `{file}.cache` sidecar beside the master
(`packages/audio-analysis/docs/analysis.md`). A song that has none draws nothing until something
measures it, and the measuring is a decode: on a four-minute mp3, ~600 ms of ffmpeg and ~220 ms of
arithmetic. Asked for at the moment somebody opens the song, that is the wait they see.

`analysisSweep.ts` is the answer: **pl8 measures its own backlog in the background**, so opening a
song finds the sidecar already there. This service holds the bytes and has ffmpeg, so nothing is
asked of a machine, and nothing is asked of the person who happened to click first.

## It fills ABSENCES, and only absences

The sweep's predicate is `readSidecar(master) === null` — no sidecar at all. A sidecar that no
longer matches the bytes beside it is a different question with a different answer: the reader
checks the fingerprint, and the surface that read it asks for a fresh analysis
(`ensureAnalysed`). Sweeping for staleness would mean fingerprinting the whole library on every
pass to find the handful of files somebody replaced.

Only a song's **master** is swept — `meta.master`, the playable file in the folder. Variants are
analysed when they are opened, being the versions of a song that mostly are not.

## One at a time, with a gap

The decode is a subprocess and yields, but `buildEnvelope` is ~220 ms of **synchronous** JavaScript
over the decoded mono stream. Serial, with a 250 ms gap between files, is what keeps the process
answering HTTP while it works: at worst it is unavailable for one envelope at a time. A backlog of
287 songs takes about four minutes and nobody notices it happen.

Passes repeat every five minutes, which is only for **files that arrive without passing through
this service** — dropped on the volume by hand, or restored from a backup. An upload is already
analysed by the surface that made it.

## Three ways it stops

- **No decoder.** A `NoFfmpegError` ends the sweep for good and says so once on the log: every
  other file would fail the same way, and a deployment without ffmpeg is not something a retry
  loop fixes.
- **A file that throws** goes into `failed` and is not tried again in this process. One
  undecodable file must not cost the whole backlog.
- **No library at all** — `exists()` is false and there is nothing to sweep.

`GET /api/mediatek/analysis` reports the state: what it is on, how many are left, what failed, and
whether there is a decoder. That route exists because a sweep with no readout is indistinguishable
from a sweep that died. A different question — one FILE's own measurement, not the sweep's
progress — is `GET /api/mediatek/envelope`: `ensureAnalysed` under the same fingerprint check, its
`rms`/`transients`/`sampleRate`/`seconds` returned as JSON. k7's `songEnvelope.ts` is its first
caller, for the songbook's reference track — a path outside `songs/`, so the sweep never reaches
it, and the route measures it on request instead.

## Why a sidecar does not disturb the catalogue

Writing 287 files into the library would move the songs revision token 287 times, and each move
costs a full rescan of the family. It does not, because the revision walk ignores `{file}.cache`
by name: derived from a file it already counts. That rule lives in
`packages/mediatek/docs/index.md`, and this sweep is what makes it load-bearing rather than tidy.
