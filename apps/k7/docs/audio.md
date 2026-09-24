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
reading its chords. It is a **song of pl8's library**, and the row keeps its path with
`AudioPath` / `AudioMime` / `AudioName`; the page streams it from pl8, k7 keeping no copy.

- **Not a `song_sheets` record**, unlike the sheet files. The rule above holds: metadata in
  PocketBase, bytes in the médiathèque. A sheet is a page; this is a whole track.
- **An upload is filed under the album `k7`**, never under the catalogue's albums: writing
  under the REAL album, where a song of that name may already be, would replace it. No upload
  here may overwrite a catalogued song; replacing an upload only overwrites k7's own folder.
- **Only a library file is a track.** A path outside pl8's `songs/` family is read as no track
  at all (`libraryPath`, `apps/k7/backend/src/store.ts`): k7 stores, copies and plays no songbook
  file of its own, so such a song shows the fetch insert like any song without one.

pl8's `/stream` answers Range — without that the waveform could draw but not seek.

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

**Onsets are not drawn.** pl8's analysis also detects transients, and `songEnvelope.ts` passes them
through as `SongEnvelope.onsets`, but the player leaves `ui-waveform`'s `onsets` prop empty: those
rules are for placing stretch points in st0, and in a player nothing acts on them — they read as
noise over the shape.

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
in pl8's library, hunts it on Soulseek when it is not there (pl8 files what it downloads) and links
its master as the reference track. **"Make instrumental"** takes the song already in the library
and has pl8 run an engine's instrumental chain over it — one file, the record without its voice.

Separating stems borrows a musician's machine for a minute or so per song and is wanted far less
often than a track to play along to, so it is asked for rather than ridden along with.

- **The hunt and the stems are asked from the page, as the user**
  (`apps/k7/frontend/src/fetchSong/pl8.ts`). pl8 refuses k7's service token on `/api/hunt` on purpose —
  a service must not spend somebody's Soulseek account — so the search runs under the person's own
  session, lands in their pl8 history and counts against their own limit.
- **A link, not a copy.** A song stores the library PATH of its master, and of the `instrumental.wav`
  beside its stems; the page streams both from pl8 itself (`/api/mediatek/stream`, with Range — a FLAC
  master comes as pl8's cached MP3), with the person's own session. k7 holds no bytes of either, so a
  song is never two files drifting apart, and pl8's own storage is the only one. The backend only
  checks and records the paths (`apps/k7/backend/src/songFetch.ts`).
- **An upload goes INTO the library**, as this song, under the album `k7` (`songs/<artist>/k7/<title>`):
  a folder of its own, so filing it never collides with — nor replaces — a catalogue song, and the
  uploaded track can be separated like any other.
- **A track is never replaced nor removed from k7**: it is a song of pl8's library, and a different
  file for it, or none, is the library's business. The ⋮ menu offers « Add a track… » only to a song
  that has none.
- **Relinking never deletes a file.** A new link, or a dropped instrumental, only forgets the old
  path: every path a song holds is the library's.
- **Any engine online makes it.** Separation needs a machine running an engine that pl8 can reach;
  the hosted image carries neither the model nor its runtime. When none is online, "Make instrumental"
  says so and changes nothing, so pressing it again once one is up is the whole retry.
- **The library song is found by artist and title** (`apps/k7/frontend/src/fetchSong/match.ts`):
  equal once accents, case and punctuation are dropped, else every typed word in the entry, else the
  same title by an artist a typo away (Gonzales / González). That is how a song FINDS its track;
  its stems are then cut from the recording it links, never looked up again by name — a same-named
  library song (a live take) might be another recording.
- **What would be hunted is checked before anything downloads** (`apps/k7/frontend/src/fetchSong/run.ts`).
  pl8 names a query through MusicBrainz (Deezer when unreachable) before searching Soulseek, and
  that name can be another song: « Expedition 33 Lumières » is the band Lumières' « Momentary ».
  k7 asks pl8 for the name alone (`/api/hunt/identify`), compares it with the song's artist and title
  (each a typo away at most, `sameSong` in `match.ts`), and only then hunts — THOSE tags, so the
  download is the recording that was checked. A mismatch downloads nothing and names what was found.
- **"Make instrumental" never hunts.** It works on the song pl8 already holds: a song missing from the
  library is a "Fetch song" away, and spending a Soulseek search on a button about stems would be a
  surprise.
- **The sum happens where the parts are.** The engine's chain writes `instrumental.wav` beside the
  song, having added the stems while they were still in memory, and that file is what the song links.
  It streams as WAV — twice a FLAC's size, the price of keeping no transcoded copy anywhere.
- **Which chain does it is the engine machine's answer**, set in st0's settings (*Separation
  chains*) or with `system instrumental <chaîne>`, exactly as `system stems` answers for the four parts. k7 names no chain: it asks for an
  instrumental and the machine that can make one says how.
- **Every step checks what is already done**, so pressing again resumes: pl8 goes on hunting and
  separating if the page is closed, and a second press finds the song filed and the stems held.
- **A failure stays on the song** (`fetchStatus`, phase `failed`), whichever step it came from, and the
  insert under the title shows it with Retry and Dismiss — a reload shows it again. A step that fails
  after the track landed is as visible as one before. LRCLIB out of reach and no engine online are
  reported the same way, without stopping the chain: one does not keep the other from running.
- **Lyrics come before stems** (search → download → lyrics → stems), because LRCLIB also says
  when a recording has **no lyrics at all**. A song LRCLIB lists as instrumental is marked
  « instrumental »: it gets no stems, since there is no voice to take out and separating one costs a
  musician's machine a minute for nothing, and the ⋮ menu offers no "Make instrumental". Nothing
  under the title says so: a song with nothing to sing needs no notice about it. LRCLIB is
  crowdsourced, so a song it has no record of still gets its stems.
- **The lyrics step only TIMES the lyrics.** A song whose lyrics are not timed yet gets LRCLIB's best
  version of THIS song (its artist and title), and its times are written into the sheet as
  `{{MM:SS.cc}}` in front of the closest lines — not a word of the sheet changes (`lyricsTiming.md`). A
  song with no lyrics gets the fetched lines themselves, timed. No version of this song, or one that
  times nothing, leaves the sheet as it was, marked « unmatched », which the insert under the title
  says — with how to type the times in by hand. Lyrics already timed are left alone.
- **"Run the pipeline again"**, in the ⋮ menu, first UNLINKS the song's library track and its
  instrumental (the library keeps both files), then runs every step from the search: asked for
  again, the pipeline must be free to find another recording than the one an earlier run linked.
  Lyrics are searched again whenever they are not timed. A fresh start never resumes a stored hunt
  or separation id: the one stored may be the one that failed, and resuming it would fail again.
- **Retry**, under the title after a failure, keeps the track and redoes only what is not done.
- **"Resync lyrics"**, in the ⋮ menu, is the lyrics step alone and on timed lyrics too: it takes
  every code off, then times the lyrics off LRCLIB again. The re-run skips lyrics that are already
  timed, because codes typed or fixed by hand must not be overwritten by an unasked search.
  An unmatched resync leaves the lyrics without codes, which is what was asked.
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
