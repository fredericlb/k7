# Session audio — where the bytes go

The server half of the rehearsal pages' audio. How a take is made in the browser is
`packages/recorder/docs/recorder.md`; how the pages play, transpose and fetch a song is
`packages/ui-rehearsal/docs/audio.md`.

## The store keeps the facts, the médiathèque keeps the bytes

A session is a row of the store ([store.md](store.md)), and its audio lives in the médiathèque's `RECORDINGS` family; the
row keeps only the path.

| | where it lives |
|---|---|
| duration, gain, envelope, tags, markers | the store |
| a session | `recordings/<day>/<HH-MM-SS>.<ext>` |
| a moment | `recordings/<day>/moment-…` |
| a published version | `songs/K7/…` |
| what the row points at | a path (`RecordingPath`, `ClipPath`, `AudioPath`) |
| sheet music | a `song_sheets` record — not audio |

The store is a database, and hours of wav have no place in one. A médiathèque is made for it: a
volume, paths, native Range, and a family whose whole role this is — see
`packages/mediatek/docs/recordings.md`. The rest of the studio can read that family; a
`song_sheets` file is readable by these routes alone. The local cache, under `K7_DATA_DIR`, serves
Range reads and fills from the médiathèque, so a cached session makes no round trip.

## The library is reached over loopback, with a service token

The médiathèque runs in the same process — k7's backend mounts both — yet this package calls it
over HTTP, through `@studio/mediatek/remote` (`remoteLibrary`, `remoteWriter`, `pushRecording`,
`pushSong`); `src/mediatek.ts` is a façade over that one client. The host hands the link in at
mount: `http://127.0.0.1:<port>` and a `service:k7` token that `mediaTokens()` mints in the same
process (`apps/k7/backend/src/server.ts`). Nothing is configured: no URL and no token in
`env.yaml`.

HTTP rather than an in-process call, because the library's routes are where its rules live — the
family a path belongs to, the 409 on a duplicate, the scan that follows a write — and a second way
in would have to restate them. Loopback rather than the public name, because a public name goes out
to the proxy only to come back, and fails whenever the proxy does.

`pushRecording` is deliberately separate from `remoteWriter`: a *writer* writes to the path it
chose, whereas a recording sends bytes **and the instant**, leaving the library to derive the
path.

## Nothing is pulled

The rehearsal server sends the bytes into the family itself: there is no sync route, and the
médiathèque does not depend on the rehearsal store, which it never reads.

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
takes are decoded and re-encoded into one file (`joinTakes`, `src/transcode.ts`). Each take is
resampled on its way in to the one stereo 48 kHz stream Opus is written at, so two takes from two
devices join whatever their rates and channel counts.

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

## Re-encodes run a few at a time, and never forever

Every re-encode this package runs — a splice, a moment's cut — goes through one limiter
(`src/transcode.ts`), two at a time by default, `K7_FFMPEG_CONCURRENCY` to change it (the name
deployments already set). The backend is one process shared by every account, and each re-encode
takes a whole core: without a cap, ten people appending a take at once are ten encoders starving
the requests around them. A call past the cap waits for a slot rather than failing, because an
append or a cut is work the user asked for and will get, only later.

The work itself is `@studio/audio-analysis`'s transcode — decoded and encoded in WebAssembly, on a
worker thread of its pool (`packages/audio-analysis/docs/transcode.md`) — so it never runs on the
thread that answers requests, and no host needs ffmpeg for it. Each run has a deadline — 30 minutes
for a splice, 10 for a cut, counted from when the pool takes it, not from the queue — past which the
worker is terminated and the call fails with a message that says so. A re-encode of hours of audio
takes minutes; one still running at the deadline is stuck, and a stuck encoder holding a slot would
hold every later one behind it.

Every file a splice or a cut reads is an upload. The decoder reads only the file it is handed,
through the host's reads: no container can make it open another resource.

The splice always re-encodes. A stream copy would be cheaper, but two takes from two devices do
not share codec parameters, and the copy is only safe when they do.

## Deleting: the bytes first

Deleting a session or a moment removes the bytes from the family **before** the row,
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
family recognises. The extension comes from the médiathèque's own table read backwards
(`extForMime`, `packages/mediatek/docs/mime.md`), so the upload, the disk cache and the zone agree.

## The time is the session's

`RecordingPath` is derived from `Sessions.CreatedAt`, not from the upload time. A take saved
after midnight belongs to the evening it was played in, and that is the date the family files it
under.

## The path or nothing

A session's audio is reached only by its path in the médiathèque. The columns
`Sessions.Recording`, `Comments.Clip`, `Versions.Audio` and `Versions.TrackFiles` are neither
declared nor read, and nothing here knows how to open an audio attachment.

Two visible consequences, both wanted:

- **`hasRecording` is derived from the PATH**, not from a `HasRecording` flag beside it. A session
  announcing a recording it cannot play is worse than one admitting it has none.
- **Extending a session with no path starts over** instead of failing: with no path there is
  nothing to splice onto, so the take becomes the first.

A row is a JSON document ([store.md](store.md)), so a field no longer declared stays in the rows
that have it. Emptying it is a manual and deliberate operation.

**Sheet music** is a file of the store's `sheets/` folder, linked to its song: not a recording, and
`uploadAttachment` / `attachmentFile` serve only that. What type any of these is served under is
[serving.md](serving.md).

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

A clip stands alone, so it is brought to EBU R128's -14 LUFS (`CLIP_LOUDNESS`): its loudness and
true peak are measured over the span first, then ONE gain is applied, lowered as far as it takes to
keep the true peak under -1 dBTP. A dynamic normaliser would reach -14 on every clip, at the price
of pumping a quiet passage up; a single gain leaves a peaky clip quieter than -14 and its dynamics
untouched, which is what a rehearsal recording is listened to for.

A moment's cut is never whole in memory: the encoder writes it to a temporary file of the cache, which
is pushed to the médiathèque as a file-backed Blob and then renamed into the cache — so a reader
never sees a half-written clip, and a three-hour moment costs disk, not 170 MB of the backend's
heap. Cuts of one moment run one at a time (`lock.ts`), each reading the row when its turn comes:
two quick drags of a span would otherwise run two encodes on one cache file, and the one that
finished last — not the one dragged last — would win.

## Published versions are songs

A published version is not a recording: it is a mixdown somebody decided was finished. So it goes
into the **SONGS** (`songs/`), under the artist `K7`:

```
songs/K7/<release title> (<release uid>)/<version name> (<version uid>)/
    original.mp3        ← the mixdown
    song.yaml           ← title, artist: K7, album, source: k7
    stems/guitare.wav   ← the separated tracks, when the import brings them
```

The uids are each one's first eight characters (`uidTag`, `src/mediatek.ts`). Five decisions in
there:

- **The folder is the version's alone.** The `K7` artist is shared by every user, and every first
  version is called "Version" or "Version 1": a folder named by titles alone would let one user's
  publish replace another's mixdown, and a delete remove it. The uids keep the name readable and
  make it unique; the title is cut to 60 characters first so the library's 80-character cap never
  eats the tag.

- **`recorded`, not `imported`.** The studio produced it; the distinction says what can be
  re-made and what is somebody else's master.
- **The release is the album, the version is the title.** Three levels for three levels, and each
  version keeps its own folder — which it needs, having its own audio. The release's artist
  survives in its row.
- **Stems go in `stems/`, not beside the master.** The scan takes the folder's first audio file
  as the master and does not descend: a track laid beside it could be played instead of the
  mixdown.
- **Republishing replaces.** The médiathèque's 409 protects a person sending the same song twice,
  not a service republishing knowingly — and the folder it replaces is this version's own.

Renaming a version **does not move the folder**; only the sidecar is rewritten: a folder path is
an entry's identifier and a cache manifest's key, so moving it would cost every machine a
re-download of bytes that have not changed.

**Deleting a version removes only what is its own.** A folder carrying the version's uid goes
whole. A folder named by titles alone — rows keep the `AudioPath` they were filed under, and older
ones have no uid in it — may hold another version's bytes, so only the files of this row that no
other version row names are removed (`forgetVersionFolder`, `src/store/versions.ts`).

**Replacing a version's file** writes into the folder its uids name — so a version filed under
titles alone moves into one of its own — and keeps the name, the stems and the place
in the release. What it must not leave behind is the previous master under another extension: the
scan takes a folder's FIRST audio file as the master, so an `original.mp3` sitting beside a new
`original.flac` is a version that plays the file nobody chose. The old path is removed whenever it
differs from the new one.

A version's waveform is measured like a songbook track's (below) and kept in `Versions.Envelope`,
cleared when the file is replaced. `Versions.AudioPath` carries the mixdown's path, and
`TrackMeta` carries `{id, path, name, mime}`.

## A songbook song's reference track

A song in the songbook carries at most one recording — the take you play along to while
reading its chords. It is a **song of the media library**, and the row keeps its path with
`AudioPath` / `AudioMime` / `AudioName`; the page streams it from the médiathèque, and this
package keeps no copy.

- **Not a sheet of the store**, unlike the sheet files. The rule above holds: metadata in
  the store, bytes in the médiathèque. A sheet is a page; this is a whole track.
- **An upload is filed under the album `k7`**, never under the catalogue's albums: writing
  under the REAL album, where a song of that name may already be, would replace it. No upload
  here may overwrite a catalogued song; replacing an upload only overwrites that folder, whose
  title carries the song's uid (`<title> (<uid>)`), so two songbook songs of one name never share it.
- **Only a library file is a track.** A path outside the library's `songs/` family is read as no
  track at all (`libraryPath`, `src/store/songs.ts`): the rehearsal server stores, copies and plays no
  songbook file of its own, so such a song shows the fetch insert like any song without one.
- **Linking only checks and records paths** (`src/songFetch.ts`). The hunt, the download and the
  stem cut are asked by the page, as the user (`packages/ui-rehearsal/docs/audio.md`); what lands
  here is the library path of the master and of its `instrumental.wav`.

The médiathèque's `/api/mediatek/stream` answers Range — without that the waveform could draw but
not seek.

**The shape is measured once, by the médiathèque, and kept in the store** (`Songs.Envelope`,
written by `src/songEnvelope.ts`): the médiathèque already holds the reference track's bytes and
already decodes it, via `@studio/audio-analysis` — the same measurement its own catalogue sweep
computes for every song, reached over `GET /api/mediatek/envelope` instead of decoding anything
here. Measured lazily, the first time a page asks for it, rather than in a migration that would
decode every song in the songbook at once.

**The médiathèque's bucketing is far finer than a waveform panel needs, so `songEnvelope.ts`
downsamples it — RMS-of-RMS for the samples, the max for the peak and the three bands, not a
second decode — to at most 800 buckets, rounded to three decimals.** The peak and the bands are
what k7's one waveform is drawn from (`packages/ui-waveform/docs/spectrum.md`), so a shape stored
without a peak is measured again the next time a page asks for it. The bands share the peak's
scale, never their own: their colour is the ratio between them. A fixed 100 ms bucket gives 3113 values for a five-minute track — 61 kB of JSON in a
cell the songbook listing reads whole, for a panel 272 px wide where that is eleven buckets per
pixel. The cap is what keeps a stored shape a few kilobytes.

**Onsets are passed through, not drawn.** The médiathèque's analysis also detects transients, and
`songEnvelope.ts` passes them on as `SongEnvelope.onsets`; the player leaves them out
(`packages/ui-rehearsal/docs/audio.md`).

Measuring in the browser on each visit is the alternative, and it is rejected: a rehearsal laptop
opening a song page should not spend seconds and a hundred megabytes of memory rebuilding a picture
that never changes; the track only changes when it is relinked, which is exactly when the stored
envelope is cleared.

## Configuration

Read from k7's backend section of `env.yaml` (`src/env.ts`): `K7_DATA_DIR` — the store
([store.md](store.md)), the local audio cache and the uploads in flight,
`~/.studio/k7` by default so a dev run needs no volume, `/rehearsal-data` on the `k7-data` volume
in the image — `CACHE_MAX_GB`, past which that cache is trimmed ([audit.md](audit.md)), and
`K7_FFMPEG_CONCURRENCY`, how many cuts and splices re-encode at once (2 by default).

`K7_API_TOKEN_SECRET` signs the personal tokens a user mints from k7's settings and saves in a
workspace's `.settings.json` to publish to these pages. It is NOT k7's `API_TOKEN_SECRET`: it
defaults to `${SESSION_SECRET}:api-token`. A token is valid only while listed in `api-tokens.json`
under `K7_DATA_DIR`, so its owner can revoke it from the settings page. `POST /api/token/publish`
mints one (never a GET, which a link could trigger), `GET` lists them and
`DELETE /api/token/publish/:id` revokes one; the rest of `/api/token` is the media library's
(`apps/k7/backend/docs/sessions.md`).
