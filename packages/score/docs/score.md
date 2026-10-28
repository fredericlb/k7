# Scores on the Sheet tab

A song's Sheet tab takes MusicXML (`.musicxml`, `.xml`, `.mxl`) and Guitar Pro (`.gp`, `.gpx`,
`.gp3`–`.gp5`) files beside its PDFs and images, and draws them as notation you can play,
transpose and zoom.

## alphaTab, not a renderer of our own

`@coderline/alphatab` is the one library that reads MusicXML, compressed `.mxl` and Guitar Pro,
draws standard notation and tablature, and plays what it draws with a cursor following —
all in the browser. OpenSheetMusicDisplay draws MusicXML well but plays nothing and reads no
Guitar Pro; Verovio engraves best but ships megabytes of WASM and leaves playback to us. A
player that already reads tablature needs the player and the Guitar Pro files more than it needs
engraving-grade output. MPL-2.0 is fine for a dependency used as published.

Its Vite plugin is the separate `@coderline/alphatab-vite` package, registered by the app that
bundles this one — k7 (`apps/k7/frontend/vite.config.ts`): the copy inside `@coderline/alphatab`
1.8 re-exports a file the package does not ship.

That plugin, in 1.8.4, writes its workers' environment import with the app's base
(`import "/@vite/env"` for an app served at the root, which k7 is), matching the unprefixed form
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
module that imports it, and the sheet panel loads it with `import()`, so no other screen pays for
it (`packages/ui-rehearsal/src/components/ScoreSheet.tsx`).

## Every part, or the one you play

A score opens with all its parts stacked in one system, as a conductor's score reads. alphaTab
draws only the first track unless told otherwise, so the viewer loads with `[-1]`, its "every
track": on a band arrangement, the first part alone hides what the rest of the band plays.

A score with more than one part has a part menu in its toolbar, **All** first, so a musician
can read their own line alone.

| choice | why |
|---|---|
| the menu changes what is drawn, never what is played | playback stays the whole band, so the part read alone is still heard in its arrangement |
| a part with no name is "Part n" | many MusicXML exports leave `part-name` empty, and a menu of blanks says nothing |
| the choice is kept per file, not per song | another file of the same song has other parts, and an index into the first one's means nothing |

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
for them under the app's base (`/font/`, `/soundfont/` on k7's origin), which k7's backend serves
like any other static file. The soundfont is not in the PWA's precache list, so playback needs the network the
first time a score is played.

## The player loads on the first Play

A score opens with alphaTab's player disabled, and the first press of Play turns it on: only then
are the synth worker started and the 1.3 MB soundfont fetched, and playback starts once they are
ready. Most scores are opened to be read, not heard, and a page that loads the soundfont on every
mount pays for it on every song of the library. While the player loads, Play is greyed out
(`ScoreState.loading`).
