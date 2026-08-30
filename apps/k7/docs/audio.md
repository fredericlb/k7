# Session audio — extended notes

## Grist keeps the facts, the médiathèque keeps the bytes

A session is a Grist row, and its audio lives in the médiathèque's `RECORDINGS` family; the row
keeps only the path.

| | where it lives |
|---|---|
| duration, gain, envelope, tags, markers | Grist |
| a session | `recordings/<day>/<HH-MM-SS>.<ext>` |
| a moment | `recordings/<day>/moment-…` |
| a published version | `songs/K7/…` |
| what the row points at | a path (`RecordingPath`, `ClipPath`, `AudioPath`) |
| sheet music | `Songs.SheetFiles` attachment — not audio |

Grist is a database, and hours of wav have no place in one. A médiathèque is made for it: a
volume, paths, native Range, and a family whose whole role this is — see
`packages/mediatek/docs/recordings.md`. The rest of the studio can read that family; a Grist
attachment is readable by k7 alone. The local cache serves Range reads and fills from the
médiathèque, so a cached session makes no round trip.

## The client is the package's

`@studio/mediatek/remote` carries `remoteLibrary` (stream a download), `remoteWriter` (write,
delete) and `pushRecording`. k7 writes no second HTTP client: `src/mediatek.ts` is a thirty-line
façade over that one.

`pushRecording` is deliberately separate from `remoteWriter`: a *writer* writes to the path it
chose, whereas a recording sends bytes **and the instant**, leaving the library to derive the
path.

## A session is ONE file

`storeBytes` covers all three entries — first save, re-record, extended session — with one rule:
if the session already has a file **of the right format**, it is rewritten in place. Otherwise
extending a session would push a second recording and the family would show two takes where
there is one. It is the only place anything names a path in the family instead of receiving one:
the file already exists and belongs to that session.

A format change is the exception: a spliced take is always webm, so a session started in ogg gets
a new file and the old one goes — **after** the new bytes have landed, never before, so a failed
upload leaves a playable file.

## Splicing a take onto a session

Extending a session does not concatenate bytes: WebM/Opus does not join end to end, so the two
takes are re-muxed into one file by ffmpeg's `concat` filter, which re-encodes. That filter
demands identical parameters from segment to segment, hence each input passing through a common
format — two takes from two devices join anyway.

Three consequences in cascade:

- **The envelope** of the new samples is appended to the old. Each take is normalised on its own
  peak, so the two halves may differ slightly in vertical scale — acceptable for an overview of
  level, which is what the envelope is.
- **The gain** kept is the smaller of the two. It is `0.9 / truePeak`, so the smaller value
  clears the louder of the two peaks and combined playback stays under clipping.
- **The disk cache** is rewritten as `.webm` whatever the previous format, and the old cache file
  — of another type — is deleted rather than left lying about.

A session with no path has nothing to splice onto: the take becomes the first one rather than
failing.

## Deleting: the bytes first

Deleting a session or a moment removes the bytes from the family **before** the Grist row,
because the row is what carries the path: the other order leaves a take in the family that
nothing names any more.

The removal is never fatal. If the library is unreachable the row goes anyway: an orphan in the
family can be seen and deleted, a session that refuses to disappear cannot.

Moments **survive** the session they came from — they have their own extract and their own view;
they only lose the link back. Markers, which exist only on a session's timeline, go with it.

## `mp4` becomes `.m4a`

Safari's `MediaRecorder` produces `audio/mp4`. The médiathèque files `.mp4` as **video**: the
family would refuse the file, and the refusal would reach the user as "upload failed" and nothing
else. An mp4 with no picture is an `.m4a` — same container, honest name, and an extension the
family recognises. The disk cache keeps `mp4`: it is a local name nobody reads.

## The time is the session's

`RecordingPath` is derived from `Sessions.CreatedAt`, not from the upload time. A take saved
after midnight belongs to the evening it was played in, and that is the date the family files it
under.

## The path or nothing: no fallback

k7 reaches a session's audio only by its path in the médiathèque. There is no second recourse:
the columns `Sessions.Recording`, `Comments.Clip`, `Versions.Audio` and `Versions.TrackFiles` are
neither declared nor read, and nothing here knows how to open an audio attachment.

Two visible consequences, both wanted:

- **`hasRecording` is derived from the PATH**, not from a `HasRecording` flag beside it. A session
  announcing a recording it cannot play is worse than one admitting it has none.
- **Extending a session with no path starts over** instead of failing: with no path there is
  nothing to splice onto, so the take becomes the first.

`migrateSchema` only adds what is missing, so an undeclared column stays present in the Grist
document. Emptying it, or emptying the tables, is a manual and deliberate operation.

**Sheet music** (`Songs.SheetFiles`) is a Grist attachment: not a recording, and
`uploadAttachment` / `downloadAttachment` serve only that.

## Moments go in the same family

A moment is an extract cut out of a session. It is filed in **that session's day folder**, beside
it, under a name carrying the three things it is:

```
recordings/2026-08-03/21-00-00.webm                       ← the session
recordings/2026-08-03/moment-21-01-30--15--The solo.webm   ← 90 s later, 15 s, named
recordings/2026-08-03/moment-21-01-30--15.webm            ← the same one, unnamed
```

The time is when the extract was **played** — `Sessions.CreatedAt` plus `StartSec` — not when it
was annotated, which may be three days later. The name is the moment's text when there is one.

Re-extracting replaces: the bound or the name may have moved, so the file name already written is
wrong. `Comments.ClipPath` carries the path.

## Published versions are songs

A published version is not a recording: it is a mixdown somebody decided was finished. So it goes
into the **SONGS** (`songs/`), under the artist `K7`:

```
songs/K7/<release title>/<version name>/
    original.mp3        ← the mixdown
    song.yaml           ← title, artist: K7, album, source: k7
    stems/guitare.wav   ← the separated tracks, when the import brings them
```

Four decisions in there:

- **`recorded`, not `imported`.** The studio produced it; the distinction says what can be
  re-made and what is somebody else's master.
- **The release is the album, the version is the title.** Three levels for three levels, and each
  version keeps its own folder — which it needs, having its own audio. The release's artist
  survives in its Grist metadata.
- **Stems go in `stems/`, not beside the master.** The scan takes the folder's first audio file
  as the master and does not descend: a track laid beside it could be played instead of the
  mixdown.
- **Republishing replaces.** The médiathèque's 409 protects a person sending the same song twice,
  not a service republishing knowingly.

Renaming a version **does not move the folder**; only the sidecar is rewritten, for this reason:
a folder path is an entry's identifier and a cache manifest's key, so moving it would cost every
machine a re-download of bytes that have not changed.

`Versions.AudioPath` carries the mixdown's path, and `TrackMeta` carries `{id, path, name, mime}`.

## k7 PUSHES; the médiathèque pulls nothing

At publication k7 sends the bytes into the family itself: there is nothing to pull from the other
side, no sync route, and the médiathèque does not depend on Grist — `@frediverse/db-grist` is not
among its dependencies.

## What stays in Grist

No audio: sessions, moments and versions are all in the médiathèque. Grist keeps the facts — who,
when, how long, which tags, what gain, what envelope — and the sheet-music files
(`Songs.SheetFiles`), which are not audio.

## Taking a take in the browser

The `useRecorder` hook records the audio and builds its level envelope (RMS) at the same time,
through the Web Audio API. It can pause and resume, so you can stop listening for a moment and
carry on with the same take; the live `samples` array feeds moment detection as it goes.

Five precautions, each paid for by a bug:

- **The audio context is resumed by hand.** Recording starts automatically after a navigation, so
  the context may be created outside a direct user gesture, and it is then born `suspended`: the
  analyser would read nothing but silence — dead meter, no moment detected.
- **It is the RAW mic track that is recorded**, not the audio graph's output. The `MediaRecorder`
  is then independent of the context's state, and a suspended context cannot produce an empty
  recording. Input level is left to `getUserMedia`'s `autoGainControl`.
- **The gain is derived from the observed peak** and applied uniformly on stop, not during: that
  is what keeps the stored envelope coherent end to end. `TARGET_PEAK = 0.9` aims the loudest
  moment just under full scale, ~ −1 dBFS.
- **The duration is rewritten into the WebM header.** `MediaRecorder` omits it, which makes the
  file unseekable: `duration` is `Infinity` and assignments to `currentTime` are ignored.
- **The screen lock is re-requested on return to the foreground.** The OS revokes it as soon as
  the tab goes to the background and never gives it back; without this catch-up a long take gets
  cut off by the device locking.

`getUserMedia` constraints are tried unprocessed first, then in fallback: Safari in particular
refuses some combinations with a `NotFoundError` ("The object can not be found here.") even
though a microphone exists.

Stopping requires a **two-second hold**, button or space bar, so a brushed key does not end an
hour-long take. The space bar is swallowed on every `keydown` while the take runs — otherwise the
page scrolls — but only starts the hold on the first; and it is ignored while the recorder is
minimised, since the stop button is then off screen.

## Detecting moments

The same detector exists twice: `apps/k7/backend/src/detect.ts` over the stored envelope, and
`apps/k7/packages/recorder/src/detect.ts` client-side, to surface moments live during a take.

The model is three sentences, and the first is the one that gets misread:

- `threshold` is the **minimum** volume the algorithm cares about: a silence floor, not a
  "loud" bar.
- A **non**-moment is any stretch of at least `minSilenceSec` seconds spent continuously under
  that floor.
- Everything else is a moment. A dip shorter than `minSilenceSec` therefore does not cut the
  moment around it.

After a splice, re-detection runs on the **stored** envelope — the whole timeline — and not on
the segment just uploaded.

## Drawing must not eat the audio

The waveform canvas is redrawn whenever the envelope's identity changes, hence the memoised
object: an envelope recreated on every render redraws on every playhead tick.

The **playback playhead is a DOM layer**, not a stroke on the canvas, for the same reason pushed
further: following it at 60 fps forced a full redraw whose allocations caused an audible hiccup
from the garbage collector.

When a session is extended the waveform shows the old take **in front of** the new: the display
timeline is offset by the length of the existing envelope, so the two stretches meet edge to
edge. The recorder's own timeline — detected moments, listening, pending annotations — stays
relative to the new take.

## The remote microphone: a Web Audio bridge

A second device can serve as the microphone: signalling goes over a WebSocket to the backend's
relay, the audio over a direct WebRTC stream between the two devices. The resulting `MediaStream`
is then handed to the normal recorder, so everything downstream is identical to a local mic.

A public STUN server is enough for two devices on one network, and for many NATs; a symmetric NAT
would want a TURN, out of scope here.

Two detours, both measured:

- **`MediaRecorder` does not reliably record a remote WebRTC track.** It often yields an empty or
  silent file while the meter — a Web Audio analyser on the same track — shows signal. The remote
  audio is therefore re-routed through the local `AudioContext` into a fresh
  `MediaStreamDestination`, and it is that locally made stream that is recorded.
- **That bridge context must be running**, or its output is silence. Autoplay policy only allows
  resuming it from a user gesture, and by the time `ontrack` fires the click is long past: it is
  therefore created and resumed immediately, as the first synchronous step, while the click that
  called is still the active gesture.

### Changing input without cutting the stream

The remote device chooses its device and, if it has several, its input channel — one input of an
audio interface, say; `"mix"` sums every channel to mono. Capture asks for the **raw** device,
unprocessed and with many channels, so individual channels survive, and falls back progressively
to more modest constraints for devices or browsers that refuse rich ones.

Changing device or channel **rewires the graph upstream** of a fixed destination node: the
gain → destination → analyser tail does not move, so the output `MediaStream`'s track never
changes and the WebRTC sender feeding the recorder carries on uncut.

A muted `<audio>` element also receives the remote stream: some Chrome versions only run their
receive pipeline once the track is attached to a media element.

Relay-side there is **one signalling room per user**, with at most one socket per role: the "one
remote device" rule falls out of the single `remote` slot. A newcomer replaces whoever occupied
its role — typically the remote device reconnecting after a refresh: the most recent wins, and
the old one is closed so it stops believing itself online. Signalling payloads (`offer`,
`answer`, `ice`, `want`) are relayed as they are, without the server looking at them.

## Configuration

**Nothing is configured by hand.** `npm run tokens` writes the two lines; see `docs/tokens.md` at
the root.

`MEDIATEK_URL` defaults to the service's **fixed** address — pl8 answers under `/pl8`, so it is
`https://studio.frediver.se/pl8`: one origin, one path per service, so a deployment has nothing
to choose. A **checkout** is the exception, and the script writes it: the public name would go
out to the LAN proxy only to come straight back to this machine, and falls over as soon as that
proxy is unreachable while both services are fine — so this server-to-server call takes the
loopback port (`http://127.0.0.1:8795`). The other half of the reason is the checkout's private
CA, which node's store does not know: measured, a `fetch` of `https://st0.priv.frediver.se` from
node fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` while the browser next to it succeeds.

`MEDIATEK_TOKEN` has no default, and without it the library answers 401: its routes are behind a
session or a token, never open. The script mints it offline, signed with the médiathèque's
`API_TOKEN_SECRET`, with `sub: "service:k7"`.

A machine with no checkout — a laptop syncing the hosted library — has no `env.yaml` and mints
its own by the intended route, connected to the médiathèque:

```bash
curl -X POST https://studio.frediver.se/pl8/api/token -b "studio.sid=<votre cookie>"
```
