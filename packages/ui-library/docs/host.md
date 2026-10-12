# What a host owes the library

`@studio/ui-library` is the médiathèque's screens — songs, samples, recordings, playlists and the
hunt — with no page of its own: no header, no gate, no router, no sentence. st0 mounts it under
`/media` (`apps/st0/frontend/src/projects/MediaPage.tsx`), and its sections are entries of st0's
home sidebar. A package rather than a folder of st0's frontend because the screens are one subject
with a contract of their own, and a contract kept in one app's tree is one nobody states.

## Two seams, because two kinds of code read them

- **`configureLibrary`** (`src/config.ts`) — the fetch layer's settings: `apiBase`, where the
  library's `/api/*` answers, and `noAnswer`, the sentence a timed-out call throws. Module state,
  set once before the first render, because `api.ts` and `enginePlayback.ts` are not components and
  a React context cannot reach them.
- **`LibraryHostProvider`** (`src/host.tsx`) — what the COMPONENTS read: the labels, the route
  `prefix` the screens live under, and who is signed in, since an engine session is per service and
  per person ([engine.md](engine.md)).

st0 sets both in `apps/st0/frontend/src/projects/MediaHost.tsx`. Its `apiBase` is its own `BASE`:
the routes are its backend's (`apps/st0/backend/docs/media/`), on the same origin, so nothing
here needs CORS or a second credential.

## Every sentence is the host's

`LibraryLabels` (`src/labels.ts`) is one typed object holding everything the screens draw, and the
host fills it from its own catalogue — st0 from paraglide, in `mediaLabels.ts`. A function where a
sentence carries a value, so the host owns the word order too. The package ships no default
language: a default is a language the host forgets to translate, and the compiler only catches a
label that is MISSING, not one left in the wrong language.

The mini player's labels are a field of it, for `@studio/ui-mini-player`'s row
(`packages/ui-mini-player/docs/miniPlayer.md`).

## The host draws the nav

`LIBRARY_SECTIONS` (`src/sections.ts`) lists the sections with their glyph and whether the
volume's summary counts them; `sectionPath` and `sectionAt` turn a section into an address under
the prefix and back. The host draws them where its own nav is — st0's sidebar, with the counts
`MediaLibrary` reports through `onCounts` — and the catalogue follows the URL ([routing.md](routing.md)).

## Playback is mounted where it plays, and only there

`MediaPlayback` holds the destination, the queue, the transport and the bar at the bottom, and it
probes an engine ([engine.md](engine.md)). A host mounts it AROUND its chrome, so a picker in the
sidebar (`PlaybackPicker`) and the catalogue's play buttons drive one transport — and only on the
pages that can play: st0's other home pages deliberately look for no engine.

## What the host gives up

The two settings cards (`@studio/ui-library/settings`) are sections of the host's own settings page
([settings.md](settings.md)); the sign-in is the host's gate. The library asks for neither a project
nor an engine before it draws.
