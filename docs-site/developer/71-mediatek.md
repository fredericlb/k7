# The mediatek package

`packages/mediatek` (`@studio/mediatek`) is the media library as a library: what lives on the
volume, how it is read, and how it is written. It holds no HTTP server. Two shells serve it: k7's
backend for the hosted volume (`apps/k7/backend/src/media`) and the file service for a machine's
local copy (`packages/file-service/src/routes/mediatek.ts`).

The choice that shapes everything: **the filesystem is the catalogue**. There is no database; a
folder on disk is an entry. That keeps the library editable by hand and makes a backup a copy, at
the cost of walking the disk, which `revision.ts` and `catalogue.ts` keep cheap.

## Subpaths

| Export | File | What it is |
|---|---|---|
| `./layout` | `src/layout.ts` | The root (`mediatekDir()`), the folders under it, `ensureLayout`, `safePath`, `writablePath` |
| `./types` | `src/types.ts` | `MediatekEntry`, `Family`, `FamilyListing`, `LibraryPlacement`, the folder names. Browser-safe. |
| `./media` | `src/media.ts` | Which extensions are audio or video, MIME types, derived-MP3 rules. Browser-safe. |
| `./scan` | `src/scan.ts` | One family read off disk into entries |
| `./revision` | `src/revision.ts` | A cheap change token per family and zone |
| `./catalogue` | `src/catalogue.ts` | The in-memory listings, search and summary |
| `./song` | `src/song.ts` | Where an uploaded song lands, the sidecar text, tags from a file name. Pure. |
| `./takes` | `src/takes.ts` | A song's versions (master first, then variants) |
| `./write` | `src/write.ts` | Every write: put, move, remove, add song, add or remove variant, set bpm or key |
| `./recordings` | `src/recordings.ts` | The capture zone: filing by day and second, moment names |
| `./playlists` | `src/playlists.ts` | The playlist zone: list and create |
| `./playlistItems` | `src/playlistItems.ts` | Resolving playlist lines against songs. Pure, shared by k7 and the DJ desk. |
| `./manifest`, `./cache`, `./remote`, `./evict`, `./ingest` | `src/*.ts` | A machine's mirror of a hosted library |

`./types`, `./media`, `./song`, `./takes` and `./playlistItems` import nothing from `node:` and
are imported by the browser.

## The volume

`ensureLayout()` creates, under `mediatekDir()`:

```text
mediatek.yaml         schema marker (version: 1) — what says "this folder is a library"
songs/                family: one folder per song, songs/<artist>/<album>/<title>/
samples/audio/        family: audio samples, first folder = pack
samples/video/        family: video samples
recordings/           zone: <YYYY-MM-DD>/<HH-MM-SS>.<ext>
playlists/            zone: <name>.yaml, nesting allowed
library/ir/ library/nam/   assets a module loads
.cache/               derived and deletable (index.json, …)
```

A **family** (`songs`, `samples`) is scanned into entries. A **zone** (`recordings`, `playlists`)
is listed by its own module. `writablePath` refuses the marker and any dot-segment, so derived
state can never be written through the API; `safePath` confines a relative path to the root
lexically and throws `PathEscapesError` (a 400 in the routes).

## Songs

- `songFolder(tags)` turns artist, album and title into three sanitised segments (`segment()`:
  NFKD, accents dropped, unsafe characters to spaces, 80 characters, no trailing dot or space).
  Empty tags become `Artiste inconnu`, `Album inconnu`, `Sans titre`.
- The master is `original.<ext>`; the sidecar `song.yaml` is written last, so a crash leaves
  orphan bytes rather than a sidecar pointing at nothing.
- `addSong` throws `SongExistsError` when the folder already has a master (a 409: the fix is a
  decision, not a retry) unless `replace` is set; `NotAudioError` for a non-audio name.
- Scan rule (`scanSongs`): a folder holding `song.yaml` or any audio is a song, and the walk stops
  there. `meta` carries `catalogued`, `master`, `stems` (all four stem files present), `artist`,
  `bpm`, `key`, `uuid`. `songs/K7/` (published rehearsal versions) is skipped.
- Variants: `variants:` in the sidecar maps a name to a file beside the master. `addSongVariant`
  edits the sidecar as TEXT (append a line at the end of the block) so comments and formatting
  survive; an inline mapping is refused rather than rewritten (`VariantRefusedError`).
- `setSongBpm` **seeds** (never overwrites an existing key); `setSongKey` forces and quotes the
  value, since `#` starts a YAML comment.

## Change tokens and the catalogue

`revision.ts` keeps, per family and for `recordings`, a token of count plus newest mtime plus a
mutation counter bumped by every write (`bumped()`), because a write the walk cannot see (same
count, same tick) must still change the token. `startRevisionRefresh()` walks off the event loop
every 10 s; a poll is a map lookup. Clients poll `/revision` and reload a section only when its
token moved.

`catalogue.ts` holds each family's listing in memory, rebuilt when its revision moves and
warm-started from `.cache/index.json`. `search()` filters across families (`family`, `q`, `kind`,
`limit` up to `SEARCH_LIMIT_MAX` = 1000).

## Writes

`write.ts` is the only writer. `putFile` takes bytes, a string, or an `OnDisk` file (an upload
streamed to disk by the backend, moved rather than copied). Every write ends with `place.ts`:
a temporary renamed onto the real name, retried on Windows while another process holds the name,
and accepted when the file already there has the same bytes.

## Derived copies

`derivedOf`, `isDerived` and `withoutDerived` (in `media.ts`) define a WebM (or a legacy MP3) beside a FLAC of
the same stem as derived: every walk hides it, so it is never an entry, a master, or a loose file.
The backend makes them (see [Media backend routes](./72-media-backend.md)).

## Reading another library

`manifest.ts` describes a family as `(path, size, mtime)`, as its owner reports it; `remote.ts` is
the HTTP client (`LibrarySource`, `remoteWriter`, `pushSong`, `pushRecording`),
written as a port so tests supply a source without a server.

## Uploading a whole tree

```bash
npm run upload-library -w @studio/mediatek -- \
  --root /path/to/library --url https://play.example.com --token <bearer> \
  [--replace] [--source <name>]
```

`scripts/uploadLibrary.ts` uploads one song per leaf folder of an `<artist>/<album>/<title>/`
tree, the sidecar's tags winning over folder names. Only masters travel.

## Tests

`npm test -w @studio/mediatek` runs vitest over every `src/*.test.ts` (scan, song filing, variants,
bpm, playlists, playlist items, recordings, cache, eviction, manifest, place, derived MP3, remote,
write) and `scripts/uploadLibrary.test.ts`. They run against a temporary root through
`STUDIO_MEDIATEK`.
