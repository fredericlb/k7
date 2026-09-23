# Session audio — extended notes

## PocketBase keeps the facts, the médiathèque keeps the bytes

A session is a PocketBase row, and its audio lives in the médiathèque's `RECORDINGS` family; the
row keeps only the path.

| | where it lives |
|---|---|
| duration, gain, envelope, tags, markers | PocketBase |
| a session | `recordings/<day>/<HH-MM-SS>.<ext>` |
| a moment | `recordings/<day>/moment-…` |
| a published version | `songs/K7/…` |
| what the row points at | a path (`RecordingPath`, `ClipPath`, `AudioPath`) |
| sheet music | a `song_sheets` record — not audio |

PocketBase is a database, and hours of wav have no place in one. A médiathèque is made for it: a
volume, paths, native Range, and a family whose whole role this is — see
`packages/mediatek/docs/recordings.md`. The rest of the studio can read that family; a
`song_sheets` file is readable by k7 alone. The local cache serves Range reads and fills from the
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

Deleting a session or a moment removes the bytes from the family **before** the PocketBase row,
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

`migrateSchema` only adds what is missing, so an undeclared field stays present in the PocketBase
collection. Emptying it, or emptying the collections, is a manual and deliberate operation.

**Sheet music** is a `song_sheets` record, linked to its song: not a recording, and
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
  survives in its PocketBase metadata.
- **Stems go in `stems/`, not beside the master.** The scan takes the folder's first audio file
  as the master and does not descend: a track laid beside it could be played instead of the
  mixdown.
- **Republishing replaces.** The médiathèque's 409 protects a person sending the same song twice,
  not a service republishing knowingly.

Renaming a version **does not move the folder**; only the sidecar is rewritten, for this reason:
a folder path is an entry's identifier and a cache manifest's key, so moving it would cost every
machine a re-download of bytes that have not changed.

**Replacing a version's file** writes into that same folder — the push is keyed by the release's
album and the version's name, which have not changed — and keeps the name, the stems and the place
in the release. What it must not leave behind is the previous master under another extension: the
scan takes a folder's FIRST audio file as the master, so an `original.mp3` sitting beside a new
`original.flac` is a version that plays the file nobody chose. The old path is removed whenever it
differs from the new one.

**A release and a page draw their audio, like the songbook does.** Same rule, same measurement —
ffmpeg on the server, capped buckets, kept in `Versions.Envelope` and cleared when the file is
replaced — and the same one component (`WaveformPlayer`), because "a shape that seeks, and a button
that stops" is one idea and not three. The song page keeps a player of its own: it carries the
Original / Instrumental switch, shares its element with the timed lyrics and is transposed with
them, which is a different job wearing the same clothes.

**Every version and every page entry gets its own player**, so a list mounts many of them. Each
one loads its audio only on the first play (`preload="none"`): a page of ten releases must not
pull ten masters before anyone presses play. The shape still loads on mount, and a spinner
stands where the shape will be, then on the button while the audio buffers. **One track plays
at a time**: starting one pauses the one before, because two masters at once is never the point.

`Versions.AudioPath` carries the mixdown's path, and `TrackMeta` carries `{id, path, name, mime}`.

## A songbook song's reference track

A song in the songbook carries at most one recording — the take you play along to while
reading its chords. It lives at `recordings/songbook/<song uid>.<ext>`, and the row keeps
`AudioPath` / `AudioMime` / `AudioName` the way a session keeps its own.

Two places it deliberately is NOT:

- **Not a `song_sheets` record**, unlike the sheet files. The rule above holds: metadata in
  PocketBase, bytes in the médiathèque. A sheet is a page; this is a whole track.
- **Not in the `songs/` family**, which is what it most looks like — it has an artist and a
  title. Filing it there would mean writing into the catalogue under the REAL artist, where
  a song of that name may already exist, and replacing it. A reference track is the
  songbook's, not the library's, and no upload here may overwrite a catalogued song.

Its own path, keyed by the song, is what makes a re-upload an overwrite and a delete exact.
A track uploaded in a different container leaves the previous file behind under a name
nothing points at, so that one is removed explicitly.

The route serves it through `streamFile`, which answers Range — without that the waveform could
draw but not seek.

### A waveform, not the browser's transport

The panel draws the track's **shape**, and a click on it seeks there and plays — seeking and
starting are one gesture, the same one a tapped lyric line already makes (`lyricsTiming.md`).
Under it sits a full-width play/pause button, and that is the whole of the transport: no counter,
no scrubber of its own. The button exists because a click on the shape can say every *where* and
no *stop* — pausing had no gesture at all. The native `<audio controls>` bar is gone; the element
itself stays, hidden, because it IS the transport and the timed lyrics follow it.

**The shape is measured once, by pl8, and kept in PocketBase** (`Songs.Envelope`, written by
`apps/k7/backend/src/songEnvelope.ts`): pl8 already holds the reference track's bytes and already
has ffmpeg, via `@studio/audio-analysis` — the same measurement its own catalogue sweep computes
for every song, reached here over `GET /api/mediatek/envelope` instead of k7 decoding anything
itself. Measured lazily, the first time a page asks for it, rather than in a migration that would
decode every song in the songbook at once.

**pl8's own bucketing is far finer than a waveform panel needs, so `songEnvelope.ts` downsamples
it — RMS-of-RMS, not a second decode — to at most 800 buckets, rounded to three decimals.** A
fixed 100 ms bucket measured 3113 values for a five-minute track — 61 kB of JSON in a cell of a
metadata store that the songbook listing reads whole, for a panel 272 px wide where that is eleven
buckets per pixel. The cap is what keeps a stored shape a few kilobytes; storing pl8's own
resolution untouched could run two orders of magnitude past that.

**Onsets ride along for free.** pl8's analysis also detects transients; `songEnvelope.ts` passes
them through as `SongEnvelope.onsets`, and the panel forwards them to `ui-waveform`'s own
`onsets` prop — a slot the component already had, unused until now.

The alternative was decoding in the browser on each visit. A rehearsal laptop opening a song page
should not spend seconds and a hundred megabytes of memory rebuilding a picture that never changes;
the track only changes when k7 itself replaces it, which is exactly when the stored envelope is
cleared.

**The instrumental wears the track's shape.** It is the same performance at the same timing, so the
picture is right where it matters — where you are in the song — and a second envelope would be a
second decode for a difference of a few decibels in the mid-band.

### The player is a panel of the page's right rail

On a desktop the player and its Original / Instrumental switch sit in the same floating rail as
the chord diagrams, collapsible by their own toggle. Above the tabs is where it used to be, and it
cost the page its first screenful: a track you keep for a whole rehearsal pushed the words you are
actually reading down. In the margin it stays reachable without displacing anything.

**The panel PLAYS; it does not change the file.** Replacing the track and removing it are in the
song's ⋮ menu, beside every other thing the song can be given or lose — a panel you keep open for
an hour should not hold a button that deletes what it is playing, and the menu is where you
already go to add a track in the first place.

**One rail, mounted once, holding the panels stacked.** Two independently fixed panels would
overlap the moment a song had chords and a track, and deciding which one covers the other is not
a decision worth having. They share the chrome (`.rail-panel`) and nothing else. The order reads
from what you are doing: **Options** first — transposition, which changes what you READ — then the
player, the chord diagrams, and the metronome. The metronome had a floating button of its own,
which is exactly the thing a rail exists to stop: two conventions for "a control that hovers over
the song".

**Folded, they are all 200 px wide.** A folded panel is a tab, and tabs of three different widths
down one edge read as breakage rather than as a stack. The word is clipped rather than wrapped.

**They all open folded.** The page is the song; a margin of three open drawers is not, and on a
laptop the chords panel alone took a quarter of the width before anyone asked it to. Folding costs
one click and is remembered for as long as the page is open. The player folded is still playing:
its panel hides the element rather than unmounting it (below).

**Collapsing hides the body; it never unmounts it.** Unmounting would take the `<audio>` element
with it — the music stops, and the timed lyrics lose the very element they follow and seek
(`lyricsTiming.md`). A collapsed panel is a track still playing behind a closed drawer.

**On a narrow screen the rail lies down**: the same panels become a bar of icons at the foot of the
screen, and an opened one rises above that bar. It is the same DOM and the same state — only the
layout changes, at one breakpoint — so nothing about a panel has two implementations to keep in
step. The glyph each toggle already carried becomes its label there, the word being what only the
desktop has room for.

A tapped chord still opens over the sheet as a popin. That is a different gesture from opening the
Chords panel — one asks "what is THIS chord", the other "what chords are in this song" — and they
answer in different places on purpose.

### Transposing moves the track, not just the sheet

The Options panel's Transpose changes the chord sheet AND what you play along to: the reference
track is pitch-shifted as it plays, in the browser, by **signalsmith-stretch** (MIT, WASM in an
AudioWorklet). The node runs in its LIVE INPUT mode, where the playback rate is ignored by
construction — so the pitch moves and the tempo cannot, which is the whole requirement. A rate
change would have been the cheap way (`preservesPitch = false`) and it is precisely the wrong one:
the song would slow down as it dropped.

Real time in the browser, rather than a render per semitone on the server. ffmpeg's `rubberband`
filter would sound better, but it means a wait the first time each key is asked for, a file per
semitone for both the track and its instrumental, and an invalidation every time the track
changes — against a gesture that is meant to be a nudge of − / + while you read. The library was
picked over `soundtouchjs` on licence as much as on quality: LGPL-2.1 in a bundled frontend is a
complication, MIT is not.

**At zero it is bypassed entirely**: no audio context, no worklet, no latency, no CPU. A song
nobody transposes pays nothing at all for this, and the graph is built the first time a semitone
is actually asked for.

The cost, while transposed: the sound trails the element's own clock by the node's latency, so a
highlighted lyric line runs slightly ahead of what you hear. It is constant and small, and the
alternative — delaying the lyrics to match — would make a seek feel late.

## Fetching a song: from pl8, into the songbook

Two entries of the song's ⋮ menu, and they are two because their costs are not the same.
**"Fetch song"** finds the song
in pl8's library, hunts it on Soulseek when it is not there (pl8 files what it downloads) and copies
the master in as the reference track. **"Make instrumental"** takes the song already in the library
and has pl8 run an engine's instrumental chain over it — one file, the record without its voice.

Separating stems borrows a musician's machine for a minute or so per song and is wanted far less
often than a track to play along to, so it is asked for rather than ridden along with.

- **The hunt and the stems are asked from the page, as the user**
  (`apps/k7/frontend/src/fetchSong/pl8.ts`). pl8 refuses k7's service token on `/api/hunt` on purpose —
  a service must not spend somebody's Soulseek account — so the search runs under the person's own
  session, lands in their pl8 history and counts against their own limit.
- **Only the copy and the mix are k7's backend** (`apps/k7/backend/src/songFetch.ts`), with its token:
  reading library files is what that token is for, and ffmpeg is in k7's image.
- **A copy, not a reference.** The track lands at `recordings/songbook/<uid>.<ext>` like an upload, and
  the instrumental at `recordings/songbook/<uid>-instrumental.flac`. The songbook song then no longer
  depends on the library song staying where it is, and removing k7's track can never delete a song
  of the catalogue.
- **Any engine online makes it.** Separation needs a machine running an engine that pl8 can reach;
  the hosted image carries neither the model nor its runtime. When none is online, "Make instrumental"
  says so and changes nothing, so pressing it again once one is up is the whole retry.
- **"Make instrumental" never hunts.** It works on the song pl8 already holds: a song missing from the
  library is a "Fetch song" away, and spending a Soulseek search on a button about stems would be a
  surprise.
- **The sum happens where the parts are.** The engine's chain writes `instrumental.wav` beside the
  song, having added the stems while they were still in memory; k7 fetches that one file and keeps it
  as FLAC, because a WAV of a whole song is twice the size for nothing heard. A song separated before
  such a chain existed has stems and no instrumental, and for it `songFetch.ts` still sums drums, bass
  and other here — without normalising, since the stems add back up to the mix at their own levels and
  scaling them would make the instrumental quieter than the original it is switched against.
- **Which chain does it is the engine machine's answer**, set in st0's settings (*Separation
  chains*) or with `system instrumental <chaîne>`, exactly as `system stems` answers for the four parts. k7 names no chain: it asks for an
  instrumental and the machine that can make one says how.
- **Every step checks what is already done**, so pressing again resumes: pl8 goes on hunting and
  separating if the page is closed, and a second press finds the song filed and the stems held.
- **A failure stays on the song** (`fetchStatus`, phase `failed`), whichever step it came from, and the
  insert under the title shows it with Retry and Dismiss — a reload shows it again. A step that fails
  after the track landed is as visible as one before. No engine online is reported the same way,
  though the chain still goes on to the lyrics.
- **The lyrics step only TIMES the lyrics.** A song whose lyrics are not timed yet gets LRCLIB's best
  version of THIS song (its artist and title), and its times are written into the sheet as
  `{{MM:SS}}` at the end of the closest lines — not a word of the sheet changes (`lyricsTiming.md`). A
  song with no lyrics gets the fetched lines themselves, timed. No version of this song, or one that
  times nothing, leaves the sheet as it was, marked « unmatched », which the insert under the title
  says — with how to type the times in by hand. Lyrics already timed are left alone.
- **"Run the pipeline again"**, in the ⋮ menu, redoes every step not done yet, and searches lyrics
  again whenever they are not timed. A fresh start never resumes a stored hunt or separation id:
  the one stored may be the one that failed, and resuming it would fail again.
- **Status writes go out one after the other** (`SongDetailContainer.tsx`): two concurrent PATCHes
  can land in either order and leave a stale phase stored, which a reload would then try to resume.

A new or removed track drops the instrumental with it: an instrumental of the previous track would
play under the wrong song. The player offers Original / Instrumental on one element, keeping the
position, so timed lyrics follow whichever plays.

## k7 PUSHES; the médiathèque pulls nothing

At publication k7 sends the bytes into the family itself: there is nothing to pull from the other
side, no sync route, and the médiathèque does not depend on PocketBase — no PocketBase client is
among its dependencies.

## What stays in PocketBase

No audio: sessions, moments and versions are all in the médiathèque. PocketBase keeps the facts —
who, when, how long, which tags, what gain, what envelope — and the sheet-music files (in
`song_sheets`), which are not audio.

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

## Where a new take opens

The recorder is mounted once, outside the router, so a take survives every navigation. It has
no route: it is drawn either in a **pop-in** over the page the take started on, or collapsed to
the bottom bar. Hiding the pop-in (its Hide button, Escape, a click on the backdrop) collapses it; the take
keeps running.

The pop-in is two wrapper classes swapped around the recorder, not a dialog component: a portal
or a conditional wrapper would re-parent `RecorderView`, and React would remount it — ending the
take it holds.

A take opens in the pop-in, from the header's record button or from resuming a session, except on
one song's page, where it begins collapsed and the page stays readable. You record against a song
in order to READ it while you play — covering the tablature the instant the tape rolls is the one
thing that use has no answer to. The bar reopens the pop-in for the controls the collapsed form
cannot carry.

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
