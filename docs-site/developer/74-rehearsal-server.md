# The rehearsal server

`packages/rehearsal-server` (`@studio/rehearsal-server`) is the rehearsal recorder's server half:
sessions and moments, releases and pages, the songbook, singing exercises, and the signaling for a
phone used as a microphone. It is mounted inside k7's backend; it has no process of its own.

## Mounting

```ts
const rehearsal = mountRehearsal(app, { requireAuth, server, mediatek });
// …later, once listening:
rehearsal.serve(httpServer);
```

`src/mount.ts` is typed against `src/index.d.ts`, a hand-written declaration: the sources run with
`noImplicitAny` off (`src/store.ts` is untyped), and the host's strict `tsc` must not read them.
Change a signature in both files.

- `mountRehearsal` must run **before** `mountMedia`: the library ends with a session-only catch-all
  on `/api`, and the rehearsal server has an unauthenticated route (`/api/public/pages`) and a
  bearer route (`/api/releases`).
- It mounts no auth, body parser or CORS; the host applies them first.
- `mediatek` is a `RemoteConfig` (`@studio/mediatek/remote`): the host's own library over loopback
  with a service token. Every audio byte goes there.
- `server(req)` returns the paired server for a local instance (see below).
- `serve()` runs the one-time PocketBase import, attaches the `/rtc` signaling socket and starts
  the cache sweeps. It must run after the library's `serve`, since the signaling listener sits in
  front of the engine registry's upgrade listener.

## Configuration

`src/env.ts` reads k7-backend's section of `env.yaml`:

| Variable | Use |
|---|---|
| `SESSION_SECRET` | RTC tickets and API tokens derive from it; the dev default is refused in production |
| `K7_API_TOKEN_SECRET` | The release bearer's secret (default `SESSION_SECRET:api-token`), kept separate so saved tokens keep verifying |
| `K7_DATA_DIR` | The store and cache (default `~/.studio/k7`) |
| `K7_INSTANCE` | `server` (default) or `local` on a desktop or phone |
| `CACHE_MAX_GB` | Disk cache of audio copies, trimmed oldest first (default 20) |
| `AUTH_ADMIN_GROUPS` | OIDC groups whose members may delete a public song |
| `POCKETBASE_URL`, `POCKETBASE_EMAIL`, `POCKETBASE_PASSWORD` | When all set and the store is empty, rows are imported once at boot |

## The store

`src/sqlite.ts` (`createSqlite(dir)`) is one SQLite file, `k7.db`, opened with `node:sqlite`
(`DatabaseSync`, WAL), plus a `sheets/` folder for sheet bytes. Rows are JSON documents in one
`records(coll, id, fields)` table: a field added to `src/schema.ts` needs no migration, and a field
a row never set reads as its type's zero value. Ids are 15 lowercase alphanumeric characters, the
shape imported PocketBase ids already have.

`src/schema.ts` declares the collections: `Sessions`, `Highlights`, `Comments` (moments), `Markers`,
`Releases`, `Versions`, `Pages`, `SingingExercises`, `Songs`, `SongFavorites`.

`src/store.ts` holds every operation on them, behind a short in-memory row cache; `src/db.ts` binds
the store to `K7_DATA_DIR`. `src/lock.ts` serialises read-modify-write per key (two appends to one
session, two sheet uploads to one song), per process, which is right for a backend that runs as
one. `src/cache.ts` shares first hits on the same work and trims the disk cache, which only ever
holds copies a miss can refill.

`src/pocketbaseImport.ts` only reads PocketBase; ids are kept so every reference holds. A failed
import answers 503 on the rehearsal paths and is retried at the next start.

## Where audio goes

`src/mediatek.ts`:

- `push` files a session's take in the library's `recordings/` zone; `pushMoment` files a moment's
  clip in the same day folder with `duration` and `label`.
- `pushVersion` files a release version as a song under the artist `K7`, its album and title
  folders tagged with the release's and the version's ids so each version has a folder of its own;
  the media library's scan hides `songs/K7/`.
- `pushSongTrack` files an uploaded songbook track under album `k7` for its artist and title.
- `src/songFetch.ts` links a songbook song to a library song (and its `stems/instrumental.wav`)
  instead of copying it.
- `src/songEnvelope.ts` shapes the library's waveform buckets for the page, measured once and kept.

## Serving bytes

Every byte the package streams goes through `src/serve.ts`, with a content type the SERVER chose:
a stored MIME was picked by a client and is never trusted. Audio is typed by the extension the
server filed it under, and an upload that does not say it is audio is refused before it is stored.
Sheets are served with `X-Content-Type-Options: nosniff`; an image gets a sandboxing
Content-Security-Policy, a PDF is served as itself, a score as bytes for alphaTab.
`src/uploads.ts` removes, whatever the route answered, every uploaded file the store did not move
into place. `src/serving.test.ts` covers both.

## Routes

All under `/api`, behind `requireAuth` unless noted.

| Prefix | Routes |
|---|---|
| `/config` | `GET /` (`{mediatekUrl}`, `""` since the library is same-origin) |
| `/sessions` | `GET /`, `POST /`, `GET /:id`, `DELETE /:id`, `POST /:id/recording` (field `audio`, `append=true` to continue), `GET /:id/recording`, `GET /:id/envelope`, `GET /:id/events`, `POST /:id/annotations`, `PUT/DELETE /:id/annotations/:annId`, `POST /:id/markers`, `PUT/DELETE /:id/markers/:markerId`, `POST /:id/annotations/:annId/validate`, `GET /:id/annotations/:annId/clip` |
| `/moments` | `GET /`, `GET /:mid`, `DELETE /:mid`, `GET /:mid/clip`, `GET/POST /:mid/markers`, `PUT/DELETE /:mid/markers/:markerId` |
| `/releases` (bearer or session) | `GET /`, `POST /`, `GET /by-song/:uuid`, `POST /import`, `GET/PATCH/DELETE /:rid`, `POST /:rid/versions`, `PATCH /:rid/versions/:vid`, `GET /:rid/versions/:vid/envelope`, `GET/PUT /:rid/versions/:vid/audio`, `DELETE /:rid/versions/:vid`, `GET /:rid/versions/:vid/download`, `GET /:rid/versions/:vid/tracks/:tid` |
| `/pages` | `GET /`, `POST /`, `GET/PATCH/DELETE /:pid` |
| `/public/pages` (no auth) | `GET /:nametag`, and per version `audio`, `envelope`, `download` (404 unless the release allows downloads) |
| `/songs` | `GET /`, `POST /`, `GET/PATCH/DELETE /:sid`, `PUT /:sid/favorite`, `GET /:sid/lrclib`, `POST /:sid/sheets`, `GET /:sid/sheets/:fid[/:name]`, `DELETE /:sid/sheets/:fid`, `POST/DELETE /:sid/audio`, `POST /:sid/audio/from-library`, `POST /:sid/instrumental/from-library`, `DELETE /:sid/instrumental`, `GET /:sid/envelope` |
| `/singing` | `GET /`, `POST /`, `PATCH/DELETE /:eid` |
| `/rtc` | `GET /ticket`, `GET /remote` |
| `/token` | `GET /`: a personal API token, session only |
| `/publications` | Whether releases and pages are reachable from this instance |

Read the route files under `src/routes/` for the exact method of each; the table groups them.

### Releases from the command line

`POST /api/releases/import` is what `project share k7` calls
(`packages/take-render/src/render.ts`, `shareToK7`): multipart `mixdown` (one) and `tracks` (up to
64 stems), with `songUuid`, `versionName`, and `title`/`artist` when the release is new. An
existing release for that `songUuid` gets a new version. Uploads are streamed to disk, never held
in memory. The file service reads the URL and token from `.settings.json` at the workspace root
(`{ "k7": { "url", "token" } }`), then `K7_URL`/`K7_TOKEN`, then `~/.studio/config.json`.

## Ownership

- Sessions, moments, releases, pages: their owner only (`ownerGuard`).
- Songs: public songs are read and edited by everyone signed in, deleted by an admin
  (`AUTH_ADMIN_GROUPS`); private songs are their creator's alone.
- Singing exercises: everyone edits, only the author deletes.
- Pages: `visibility` is `private`, `authenticated` or `public` (`@studio/rehearsal-shared/pageVisibility`);
  an empty value on an old row reads as public. The version a page plays is
  `pageVersion()` in `@studio/rehearsal-shared/pageVersion`, shared with the editor so the link
  never plays something the owner did not pick.

## Server, desktop and phone

- `src/publications.ts`: releases and pages live on the server only. With `K7_INSTANCE=local`,
  `PUBLICATION_ROUTES` are forwarded to the paired server as the person who paired it, and answer
  503 when it cannot be reached. The server answers devices at `DEVICE_ROUTE` (`/api/sync/k7`).
- `src/songbookCopy.ts`: the server tells a device the songs its person may see; the device places
  its own against them by id and copies one down with its sheets and track. A copy carries `Origin`
  and is read-only.
- `src/momentShare.ts`: a device shares a moment (clip, span, text, markers) up; sharing again
  replaces the server's copy. The copy keeps the device's moment id and carries `SharedFrom`.

The routers mounting these sides are wired in `apps/k7/backend/src/media/routes/serverCopy.ts`.

## Remote microphone signaling

`src/rtc.ts` relays SDP and ICE over a WebSocket at `/rtc` on the shared HTTP server. The upgrade
cannot read the session cookie, so the page first gets a short-lived ticket (`GET /api/rtc/ticket`)
and presents it on the socket URL. One `remote` per person; a new one replaces the old. The audio
itself is peer-to-peer WebRTC between the two browsers.

## Tests

`npm test -w @studio/rehearsal-server` runs `src/*.test.ts`: `sqlite`, `cache`, `lock`, `lrclib`,
`momentShare`, `pocketbaseImport`, `publications`, `publicPages`, `serving`, `songbookCopy`,
`songEnvelope`.
