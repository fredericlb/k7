# Media library and rehearsal recorder: overview

Two features of k7 live outside any project: the **media library** (médiathèque, mounted at
`/media`) and the **rehearsal recorder** (mounted at `/rehearsal`). Both are served by k7's one
backend process and drawn by k7's frontend; neither has a server or an app of its own.

## The packages

| Package / directory | Role |
|---|---|
| `packages/mediatek` | The media library as a library: the volume layout, the scan, the catalogue, every write. No HTTP. |
| `apps/k7/backend/src/media` | The media library's HTTP surface (`mountMedia`), the hunt, the stems cut, the sweeps |
| `packages/stem-separation` | The seam a stem separation is handed through, and the job id |
| `packages/mpv-player` | Playing on the server's own outputs (the "media library" playback destination) |
| `packages/ui-library` | The media library's screens, mounted by k7 |
| `packages/ui-mini-player` | The transport bar at the bottom of a page |
| `packages/rehearsal-server` | The rehearsal recorder's routes (`mountRehearsal`) and its SQLite store |
| `packages/ui-rehearsal` | The rehearsal screens, with their own paraglide catalogue |
| `packages/rehearsal-shared` | Types and rules both rehearsal halves read |
| `packages/recorder` | Recording a take in the browser, live highlight detection |
| `packages/lyrics` | Chord sheets, transposition, LRC and inline timecodes |
| `packages/tablature` | ASCII tablature parsed and drawn |
| `packages/score` | MusicXML and Guitar Pro through alphaTab |

All of them are consumed as TypeScript source through `package.json` `exports` subpaths.

## How k7 mounts them

Backend, in `apps/k7/backend/src/server.ts`:

1. `mountRehearsal(app, …)` first. Its public pages (`/api/public/pages`) are unauthenticated and
   its `/api/releases` takes a bearer token, while the media library ends with a catch-all `/api`
   guard; mounted after, the rehearsal routes would be swallowed.
2. `mountMedia(app, …)` (`apps/k7/backend/src/media/mount.ts`).
3. Host aliases: a request on a `play.` host is redirected to `/media…`, one on `k7.` to
   `/rehearsal…` (the `ALIASES` table in `server.ts`).

Frontend, in `apps/k7/frontend/src/appMain.tsx` and `apps/k7/frontend/src/projects/`:

- `MediaPage.tsx` mounts `MediaHost` (labels, prefix, signed-in user), `MediaPlayback` (the
  transport) and `MediaLibrary` inside the home frame (`HomeSidebar.tsx`), which draws
  `LIBRARY_SECTIONS` as sidebar entries with counts.
- `RehearsalHost.tsx` configures the rehearsal fetch layer and follows k7's locale;
  `RehearsalRecording` wraps every home route so a take survives navigation; `RehearsalPage.tsx`
  lazy-loads `RehearsalRoutes`.
- `/rehearsal/@<nametag>` (a public page) is read **before** the sign-in gate.
- `apps/k7/frontend/src/settings/SettingsPage.tsx` mounts the lazy `RehearsalSettings`;
  `RegisteredEngines.tsx`, on the engine page, mounts `EnginesSettings`; `ServerPage.tsx` mounts
  `EngineOwnersSettings` and `SlskdSettings`.

## Where data lives

| Data | Where | Owner |
|---|---|---|
| Songs, samples, recordings, playlists | The media library volume, `$STUDIO_MEDIATEK` (default `<state>/mediatek`, see `packages/engine-client/src/paths.ts`) | `packages/mediatek` |
| Derived state (index, waveform caches, mpv sockets, hunt history, slskd settings) | Dot-directories on the same volume: `.cache/`, `.player/`, `.hunts/`, `.settings/` | the backend |
| Rehearsal rows and sheet files | `k7.db` and `sheets/` under `K7_DATA_DIR` (default `~/.studio/k7`) | `packages/rehearsal-server` |
| Session audio, moment clips, published versions | The media library: `recordings/` and `songs/K7/` | written by the rehearsal server through the library's HTTP API |

The rehearsal store carries **no audio**: it keeps paths into the media library, and a disk cache
of copies for Range requests (`packages/rehearsal-server/src/cache.ts`), trimmed past
`CACHE_MAX_GB` (20 by default).

## Server, computer and phone

The same backend runs on the hosted server and, bundled, inside the tray and the Android app. On a
device:

- The media library and the songbook are local; a paired device compares its entries with the
  server's by path or id and downloads what it lacks (`apps/k7/backend/src/media/routes/serverCopy.ts`).
- Releases and pages exist on the server only: with `K7_INSTANCE=local`, the rehearsal server
  forwards their routes to the paired server (`packages/rehearsal-server/src/publications.ts`).
- Moments can be pushed to the server (`packages/rehearsal-server/src/momentShare.ts`); sessions
  never leave the device.
- The FLAC to Opus sweep is turned off with `STUDIO_STREAM_SWEEP=0`.

## The pages in this range

- [The mediatek package](./71-mediatek.md)
- [Media backend routes](./72-media-backend.md)
- [The media library screens](./73-ui-library.md)
- [The rehearsal server](./74-rehearsal-server.md)
- [The rehearsal screens](./75-ui-rehearsal.md)
- [Recorder, lyrics, tablature, score](./76-rehearsal-libraries.md)
- [Testing and extending](./77-media-testing.md)
