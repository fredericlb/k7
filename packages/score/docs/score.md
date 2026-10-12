# Scores on the Sheet tab

A song's Sheet tab takes MusicXML (`.musicxml`, `.xml`, `.mxl`) and Guitar Pro (`.gp`, `.gpx`,
`.gp3`–`.gp5`) files beside its PDFs and images, and draws them as notation you can play,
transpose and zoom.

## alphaTab, not a renderer of our own

`@coderline/alphatab` is the one library that reads MusicXML, compressed `.mxl` and Guitar Pro,
draws standard notation and tablature, and plays what it draws with a cursor following —
all in the browser. OpenSheetMusicDisplay draws MusicXML well but plays nothing and reads no
Guitar Pro; Verovio engraves best but ships megabytes of WASM and leaves playback to us. A
songbook that already reads tablature needs the player and the Guitar Pro files more than it
needs engraving-grade output. MPL-2.0 is fine for a dependency used as published.

Its Vite plugin is the separate `@coderline/alphatab-vite` package, registered by the app that
bundles this one — st0 (`apps/st0/frontend/vite.config.ts`): the copy inside `@coderline/alphatab`
1.8 re-exports a file the package does not ship.

That plugin, in 1.8.4, writes its workers' environment import with the app's base
(`import "/@vite/env"` for an app served at the root, which st0 is), matching the unprefixed form
the dev server's import analysis resolves — the form Vite writes for its own module workers. An app
based under a path would need that base stripped back off in dev.

## On the Sheet tab, not a tab of its own

A score is sheet music that arrives as a file, which is exactly what the Sheet tab already
stores, uploads and deletes. A separate tab would be a second copy of that plumbing for one more
file type.

## Recognised by extension

Browsers send these files as `application/octet-stream` or `text/xml`, so the media type cannot
say what they are. `packages/rehearsal-shared/sheetKind.ts` decides from the extension and stores
the score under its own media type; the server's upload check, the Sheet tab and both exports all
ask that one module, so they cannot disagree about what a file is.

## Loaded only where a score is shown

alphaTab is the heaviest dependency the rehearsal pages have. `src/ScoreView.tsx` is the only
module that imports it, and the Sheet tab loads it with `import()`, so no other screen pays for it
— the same choice the export generators make (`packages/ui-rehearsal/docs/export.md`).

## Transposition is one setting

`notation.transpositionPitches` moves what is drawn and what is played together, so what you read
is what you hear. alphaTab's `changeTrackTranspositionPitch` is never used as well: it adds to the
setting rather than replacing it, and the sound would move twice. Drum tracks stay at 0 — a kit
has no key.

## Full screen is one scrolling column

A score can go full screen with its toolbar, which stays on top so play and transpose remain at
hand. The score under it is alphaTab's page layout — systems wrapped to the screen's width and
stacked downwards — scrolled as one column that the playback cursor keeps in view. There are no
page turns: on a music stand a turn is a gesture you do not have a hand for, and a column the
cursor scrolls needs none. Only scores get this; a PDF or an image is drawn by the browser, not by
the app.

## What the exports leave out

A score is in neither the PDF nor the EPUB export. It is notation, not a page, and drawing it to
paper is a job the export does not take on.

## Where its files live

The plugin copies the Bravura font and the SONiVOX soundfont into the build, and the viewer asks
for them under the app's base (`/font/`, `/soundfont/` on st0's origin), which st0's backend serves
like any other static file. The soundfont is not in the PWA's precache list, so playback needs the network the
first time a score is opened.
