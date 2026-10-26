# The media library screens

`packages/ui-library` (`@studio/ui-library`) draws the media library: the catalogue, a song, the
playlists, the hunt, playback and the queue. It has no page or router of its own. k7 mounts it
under `/media` (`apps/k7/frontend/src/projects/MediaPage.tsx`) and hands it everything
host-specific.

## The host contract

Two channels, because half the package is not React:

- **`configureLibrary({ apiBase, noAnswer })`** (`src/config.ts`): module-level settings for the
  fetch layer (`src/api.ts`, `src/engine/enginePlayback.ts`), which a context cannot reach. k7
  calls it once on import of `apps/k7/frontend/src/projects/MediaHost.tsx`, with `apiBase` its own
  origin.
- **`LibraryHostProvider`** (`src/host.tsx`): `{ labels, prefix, user }` for components. `prefix`
  is where the screens live (`/media`); `user` names the engine session.

**Labels**: every sentence the package draws is a field of `LibraryLabels` (`src/labels.ts`), a
function where the sentence carries a value so the host owns word order. k7 fills it from its own
paraglide catalogue (`apps/k7/frontend/src/projects/mediaLabels.ts`, messages `media.*` and
`wsync.*` in `apps/k7/frontend/messages/en.json` and `fr.json`). Adding a sentence means a field in
`labels.ts`, a line in `mediaLabels.ts`, and a message in both catalogues.

Exports (`src/index.ts`): `configureLibrary`, `LibraryHostProvider`, `MediaLibrary`,
`MediaPlayback`, `PlaybackPicker`, `LIBRARY_SECTIONS`, `sectionAt`, `sectionLabel`, `sectionPath`,
`SECTION_IDS`. `./settings` exports `EnginesSettings`, `EngineOwnersSettings` and `SlskdSettings`.

## Routing

`src/routes.ts` is the URL to screen mapping, pure and tested both ways:

- `/<prefix>/<section>` where section is `songs`, `samples`, `recordings`, `playlists` or `find`.
- `songs` and `playlists` carry a second half, the open file, section-relative and encoded per
  segment (`encodeURI` leaves `#` and `?` alone).
- Anything unknown falls back to `songs` rather than a 404.

`useLibraryRoute` mirrors `{section, file}` with the URL in both directions; the URL is the only
writer. The open song is DERIVED from the route and the listing, never stored beside it, so a
deep link needs no replay. `src/sections.ts` lists the sections with their icon and whether the
summary counts them, which the host's sidebar draws.

## The catalogue screen

| File | Role |
|---|---|
| `src/MediaLibrary.tsx` | The screen: tree on the side, contents in the middle; the drop and picker targets |
| `src/useLibraryData.ts` | Counts, the open section's listing, and one 3 s poll that reloads a section only when its token moved |
| `src/libraryTree.ts` | Listing to tree rows and back. Pure. A tree path is FAMILY-relative; an entry's path is not. |
| `src/treeActions.ts` | Right-click menus: `songActions` for Songs, `assetActions` for writable families |
| `src/LibraryContents.tsx` | The list, or the capture zone's days |
| `src/AddSong.tsx`, `src/AddRecording.tsx` | The upload buttons; tags are read in the browser with `music-metadata`, loaded lazily |
| `src/SongEditor.tsx`, `src/SongTagsForm.tsx` | A song: its tags in a form autosaved with `useAutosave`, the player, the variants |
| `src/SongPlayer.tsx`, `src/SongVariants.tsx`, `src/songWaveform.ts` | Version tabs over the shared waveform |
| `src/Playlists.tsx`, `src/PlaylistRows.tsx` | The playlist zone; every graphical edit goes through the TEXT (`@studio/song-schema/playlist`) |
| `src/FindSongs.tsx` | The hunt page, polled every 2 s |
| `src/ServerCopy.tsx`, `src/serverSets.ts` | A paired device's placement and downloads |
| `src/EnginesSettings.tsx`, `src/EngineOwnersSettings.tsx`, `src/SlskdSettings.tsx` | The three settings cards |
| `src/prefs.ts` | The account's media preferences, read once and patched whole (the route replaces wholesale) |

Songs refuse ordinary tree writes: a file joins songs only as a variant of one, and songs are
added through the tags dialog. Recordings refuse them too. Every other family gets
`assetActions`. A menu opens only if one action's `when` passes, so each target needs one.

## Playback

`MediaPlayback` wraps `PlaybackProvider` (`src/playback/PlaybackProvider.tsx`), above the screens so
what plays outlives the screen that started it. It exposes `now`, `playing`, `position`,
`duration`, `start`, `toggle`, `seek`, `close`, `error`, `ended`, the destination (`target`,
`choose`, `engineAvailable`) and the queue.

Destinations are one list, `PLAYBACK_TARGETS` in `src/playback/targets.ts`:

| Id | Driven by |
|---|---|
| `browser` | An `<audio>` element this tab owns, on `/api/mediatek/stream` |
| `library` | mpv on the server, through `/api/player/*`, polled |
| `engine` | The account's engine: `useSongEngine` opens one socket only while this destination is chosen; `enginePlayback.ts` brings the song to the engine's machine (`/api/engine-local`) and sends a one-clip document |

The ids are stored on the account as `playbackTarget` and are permanent. `effectiveTarget()`
decides the fallback once: a destination that needs an engine falls back to `browser` when none
answers. A new destination is one entry in `PLAYBACK_TARGETS` plus its labels and its branch in the
provider; the picker needs no change.

The queue (`src/playback/queue.ts`) is pure: `enqueue` without duplicates (keyed by song path),
`removeAt`, `moveTo` with `to` as the final index. `useQueueAdvance` starts the next item when the
current one ends by itself, skipping what does not resolve.

## The mini player

`packages/ui-mini-player` (`@studio/ui-mini-player`, `src/MiniPlayer.tsx`) is the bar only: play,
title, meta, scrubber, close, and a slot for host controls. It holds no transport; every number is
a prop and every button a callback, because its hosts (the media library and k7's reference
tracks) play very different things. `src/mediaSession.ts` fills the browser's Media Session from
the same props, so a lock screen and a headset drive the callbacks; on Android the app relays these
calls to a native session. Strings come in as `MiniPlayerLabels`.

`src/playback/MiniPlayer.tsx` in ui-library is the media library's reading of it, with the version
badge, the destination and the `QueueButton`.

## Tests

`npm test -w @studio/ui-library` covers the pure modules: `routes.test.ts`, `libraryTree.test.ts`,
`api.test.ts`, `poll.test.ts`, `serverSets.test.ts`,
`playback/queue.test.ts`, `playback/targets.test.ts`. Nothing mounts a component: check a visual
change in the running app.
