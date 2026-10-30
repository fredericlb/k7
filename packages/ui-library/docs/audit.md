# Audit — stability and speed of the library's screens

A standing audit of `packages/ui-library/src`, the médiathèque's screens as k7 mounts them under
`/media`. The routes' half is
[apps/k7/backend/docs/media/audit.md](../../../apps/k7/backend/docs/media/audit.md). Findings are
either an invariant this package holds — written down so it is not broken again — or a numbered lot
still open, and why.

## The page's polls do not stack

The library's revision poll and the hunt list go through
`src/poll.ts`: the next tick is scheduled when the last one ENDS, so a slow server slows the poll
rather than stacking requests behind it on the browser's six connections per host — the same
connections the audio's Range requests need. The library and the hunt list rest while the tab is
hidden and tick at once on its return. A listing that lands after the user changed section is dropped: drawn, it would sit
under the new section and be marked as current.

## Every call from the page has a budget, and an upload has a cancel

Every request `src/api.ts` makes goes through one `request()`: 30 s by default, 10 s for the host's
transport, ten minutes for an analysis that may queue behind the decode gate, and a sentence —
the host's `noAnswer` label — rather than a `DOMException` when one runs out. An upload has NO time
budget — a 500 MB file over a slow link is legitimate, and only the person sending it knows it is
not — but takes a signal: the song dialogue's Cancel cuts the upload in flight, and the recordings
button becomes the way to stop a batch while it sends. The server removes what a cut upload left.

## The catalogue screen is split by concern

`src/MediaLibrary.tsx` draws; what it shows of the volume and the poll are `useLibraryData.ts`, the
rows built from a listing `libraryTree.ts` (pure, tested alone), the menus `treeActions.ts` and the
middle pane `LibraryContents.tsx` ([library.md](library.md)). The transport and the bar are
`MediaPlayback.tsx`'s, apart from the catalogue, so a host mounts playback only where it plays.

## The editor stack is fetched when text is shown

`YamlPane` is `@studio/ui-editor`'s, and CodeMirror with its vim mode weighs more than every other screen
here together. The playlists reach it through `src/LazyYamlPane.tsx`, so the
catalogue draws without it and the pane arrives the first time a file is opened as text. The package
declares `"sideEffects": false`: the host's sidebar imports the section list through the barrel, and
without that declaration the bundler keeps every screen the barrel names — and what they import — in the
host's first chunk ([apps/k7/frontend/docs/audit.md](../../../apps/k7/frontend/docs/audit.md)). A module
here must therefore never rely on being imported for its effect.

## Left as lots

1. **The registry's calls from the page are unbudgeted.** `@studio/engine-browser`'s access
   client fetches with no timeout; a budget there belongs to that package and to every host of it.

## What a change here should be verified with

```
cd packages/ui-library && npx tsc --noEmit -p . && npx vitest run
```

Nothing here mounts a component: open `/media` in k7 against a live backend for anything drawn.
