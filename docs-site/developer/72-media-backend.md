# Media backend routes

The media library's HTTP surface is `mountMedia(app, { requireAuth, port, tokens })` in
`apps/k7/backend/src/media/mount.ts`, called by `apps/k7/backend/src/server.ts` after
`setupAuth` and `mountRehearsal`, and before the SPA fallback. It mounts no auth middleware and no
CORS of its own: `server.ts` applies both to the whole process (`apps/k7/backend/src/media/cors.ts`
answers every origin's credentialed request, since k7 and its aliases call it from hosts that
cannot be listed in advance).

Besides the library, `mountMedia` mounts the engine registry (`@studio/engine-registry`), the
account file hub (`apps/k7/backend/src/media/fileHub.ts`, which refuses to start without
`$STUDIO_FILES_ROOT`), the shares and their public player. Those belong to other sections of this
guide; this page covers the library, the hunt, the stems and playback.

## Authentication

`mediaTokens()` creates a bearer scheme from `API_TOKEN_SECRET` (or `SESSION_SECRET` + `:pl8`, so
tokens issued before stay valid). `bearerOrSession(requireAuth)` accepts either a session cookie
or `Authorization: Bearer <token>`: the rehearsal server and an account's file service call the
library without a cookie jar. A few routes take the **session only**, because they spend an account
or hold secrets.

| Route | Guard |
|---|---|
| `/api/mediatek/*` | bearer or session |
| `/api/hunt/*` | session only |
| `/api/settings/*` | session only, and an admin (`isAdminRequest` in `apps/k7/backend/src/media/admin.ts`: the session's `groups` against `AUTH_ADMIN_GROUPS`, which empty admits nobody); 403 otherwise |
| `/api/stems/*` | bearer or session |
| `/api/engine-local` | session |
| `/api/player*` (mpv) | bearer or session, and the catch-all guard for every `/api` route mounted after it |
| `POST /api/token` | session only: mints a bearer for the signed-in user |
| `GET /api/token/pair?return=…` | session; redirects a token to a loopback address only (`isLoopbackReturn`) |

## `/api/mediatek` — the library

`apps/k7/backend/src/media/routes/library.ts`. The local file service answers the same
vocabulary, so a mirror can ask either side the same questions.

| Method and path | Does |
|---|---|
| `GET /` | Whether a library is present, and the counts |
| `GET /revision` | The change tokens per family and zone |
| `GET /list?family=` | One family's listing plus its token and unlisted paths |
| `GET /manifest?family=` | `(path, size, mtime)` of a family, for a mirror |
| `GET /search` | Filter across families (`family`, `q`, `kind`, `limit`) |
| `GET /file?path=` | One file's bytes, with Range |
| `GET /stream?path=` | As `/file`, but a FLAC is served as its MP3, transcoded now if need be (503 without ffmpeg) |
| `PUT /file?path=` | Write a file by path (raw body) |
| `POST /song?filename=&artist=&album=&title=[&source=][&replace=1]` | File an upload as a song from its tags. 409 `{exists:true}` when occupied. |
| `POST /variant`, `DELETE /variant` | Add or remove a song variant |
| `GET /tags?path=<folder>`, `PUT /tags?path=<folder>` | Read a song's tags from its master (and `others`: the file's remaining tags, read-only), or rewrite the five (JSON: a field absent is kept, `""` clears it; 422 for a master TagLib cannot write) |
| `POST /analyse` | Measure a file (waveform, onsets, tempo) and write its `.cache` sidecar |
| `GET /envelope?path=` | A file's waveform envelope |
| `GET /analysis`, `GET /mp3` | The state of the two background sweeps |
| `POST /bpm`, `POST /key` | Seed a song's tempo, set its key, in the master's tags |
| `GET /recordings` | The capture zone by day |
| `POST /recording?filename=[&at=][&duration=][&label=]` | File a capture; with `duration`, a moment |
| `GET /playlists`, `POST /playlists` | List playlists, create one (409 when taken) |
| `POST /move`, `POST /folder`, `DELETE /folder`, `DELETE /file` | Move or rename, create a folder, remove a tree or a file |

Uploads never go through memory: `rawToDisk()` (`apps/k7/backend/src/media/upload.ts`) streams
the body to a file next to its destination and `putFile` moves it; anything left when the response
closes is removed.

Refusals map to statuses: `PathEscapesError` and `NotWritableError` are 400, `NotAudioError` 400,
`SongExistsError` 409.

## Background work

Started in `serve()` once the server listens:

- `startRevisionRefresh()` keeps the change tokens current off the event loop.
- `startAnalysisSweep()` (`analysisSweep.ts`) measures songs with no `.cache` sidecar, one at a
  time, so opening a song finds its waveform. Every decode goes through `analysisGate.ts`: one per
  file, a bounded number at once, since a decode holds the whole mono signal in memory.
  `analysisMarks.ts` keeps, on the volume, the files a decode failed on or was running on when the
  process died, keyed by the file's fingerprint, so neither a sweep after a restart nor a listener
  decodes them again; replaced bytes are tried again.
- `startStreamSweep()` (`streamSweep.ts`, `streamCopy.ts`) writes an Opus WebM beside every FLAC
  (missing or older than its FLAC). Off with `STUDIO_STREAM_SWEEP=0`, which the user's own machine sets.
  Transcodes are queued: `MAX_TRANSCODES` (2) run at once and `MAX_WAITING` (8) wait; past that,
  `/stream` answers 503 rather than starting one more ffmpeg.
- Leftover uploads are cleared, and the volume layout is ensured, so an empty volume is a working
  library rather than a 404.

## `/api/hunt` and `/api/settings` — Find songs

`routes/hunt.ts` is the HTTP surface; the work is `hunt/hunt.ts`, run in the background and
written to a per-person history (`hunt/store.ts`, JSON under `.hunts/`, or `$STUDIO_HUNTS_DIR`,
the last 100 kept).

| Route | Does |
|---|---|
| `GET /api/hunt` | `{configured, reason, youtube, hunts}` |
| `GET /api/hunt/identify?q=` | What a query would hunt (tags), downloading nothing |
| `POST /api/hunt` `{query, tags?}` | Start a hunt. 503 unconfigured, 400 empty or over 200 characters, 429 past 4 running per person |
| `POST /api/hunt/:id/youtube` | The yt-dlp fallback, only for a row that failed because Soulseek was exhausted (`canFallBackToYoutube` in `@studio/web-protocol/hunt`, shared with the button) |
| `DELETE /api/hunt/:id` | Cancel if running, and remove the row |
| `GET /api/settings/admin` | Whether the session is an admin, for any signed-in user |
| `GET/PUT /api/settings/slskd`, `POST /api/settings/slskd/check` | The instance's slskd and SFTP settings |

The pipeline: `musicbrainz.ts` identifies the song (`deezer.ts` only when MusicBrainz throws);
`slskd.ts` searches (a 12 s window) and enqueues; `rank.ts` ranks candidates; a peer gets
`NO_START_MS` (60 s) to start, and after `MAX_SWITCHES` (10) moves the hunt fails; `sftp.ts` brings
the file back from slskd's machine; `addSong` files it with `source: slskd` (or `youtube` through
`youtube.ts`). The fallback is a button, never automatic.

Settings live in one file, `.settings/slskd.json` (or `$STUDIO_SETTINGS_DIR`), shared by the
instance; `settings/secret.ts` seals the API key, password, key and passphrase with the session
secret, and a secret that no longer opens reads as none.

## `/api/stems` — cutting a song

`routes/stems.ts` and `stems/cut.ts`. The library holds the bytes, so the cut is driven from here;
an engine's machine lends its model and CPU over the tunnel's jobs channel.

| Route | Does |
|---|---|
| `POST /api/stems` `{song, engineId, chain?, want?}` | `{ready:true}` when already held, else starts or joins the job and answers `{ready:false, job}`. `want` is `stems` (default) or `instrumental`. 409 for an unregistered engine. |
| `GET /api/stems/held?song=&want=` | Is it already cut, without starting anything |
| `GET /api/stems/:id` | The job's progress; 404 once swept (callers then ask the disk) |

`heldFor()` answers from the folder: four stems means `stems/drums.wav`, `bass.wav`, `other.wav`,
`vocals.wav` all present (`@studio/song-schema/stems`); an instrumental is `stems/instrumental.wav`.
The account's file service says which chain the cut runs (`fileHub.coldRun`).

`packages/stem-separation/src/separateJobs.ts` is the seam for hosts that run separations through
an installed `SeparationRunner`: `separationId()` keys a job by its WORK (user, source, model,
outputs) so the same request joins the running job instead of starting another.

## Playback

- **The media library destination** is `@studio/mpv-player` (`packages/mpv-player/src/router.ts`):
  `GET /api/player`, `POST /api/player/play`, `/pause`, `/seek`, `/stop`, per person, with mpv's
  sockets under `.player/` on the volume.
- **The engine destination** uses `POST /api/engine-local` `{engineId, path}`
  (`routes/engineLocal.ts`): the song is brought down to the engine's machine through the tunnel
  first, and the answer is its path there, which the browser then hands the engine.

## Paired devices

`routes/serverCopy.ts` mounts both sides of the server copy:

| Path | Side | Does |
|---|---|---|
| `/api/sync/mediatek` | server, device token | A paired device reads the library |
| `/api/sync/library` | device, session | Placement of a family against the server; `POST /download` brings entries down |
| `/api/sync/songbook`, `/api/sync/songbook-copy` | server / device | The songbook copy (rehearsal) |
| `/api/sync/k7` | server | Releases and pages for a device |
| `/api/sync/moments`, `/api/sync/moments-share` | server / device | Sharing a moment up |

Entries are matched by **path**: the two volumes share an id space, so a song that differs in
content but not in path reads as synced.

## Tests

`npm test -w k7-backend` (vitest) covers `routes/library.test.ts`,
`routes/shares.test.ts`, `routes/serverCopy.test.ts`, `routes/engineLocal.test.ts`,
`routes/settings.test.ts`, `hunt/*.test.ts`, `stems/cut.test.ts`, `streamSweep.test.ts`,
`transcodeQueue.test.ts`, `analysisGate.test.ts`, `analysisMarks.test.ts`,
`settings/store.test.ts`, `upload.test.ts`, `cors.test.ts`. They point `STUDIO_MEDIATEK` and the
other `STUDIO_*_DIR` variables at temporary folders.
