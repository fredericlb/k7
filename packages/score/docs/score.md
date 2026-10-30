# Scores on the Sheet tab

A song's Sheet tab takes MusicXML files (`.musicxml`, `.xml`, and the compressed `.mxl`) beside its
PDFs and images, and draws them as notation you can play, transpose and zoom.

## Verovio draws, spessasynth plays

`verovio` engraves the score. It reads MusicXML into its own model, which keeps a clef change where
the file puts it: in the middle of a bar, or on a left-hand staff written after the right hand's
notes. A piano's left hand moves between treble and bass all the time, and a reader that drops
those changes draws a bass line on ledger lines above a treble staff. That is what the previous
reader, alphaTab, did: it keeps one clef per bar and reads none after the bar's first note. Verovio
is engraving-grade, which is what a musician reading from the screen needs more than anything else
this view does. It is LGPL-3.0 and used as published.

Verovio plays nothing. It writes the score as MIDI (`renderToMIDI`) and says which notes sound at a
given time (`getElementsAtTime`). `spessasynth_lib` plays that MIDI through a SoundFont, its
synthesizer running in an AudioWorklet so a busy page does not make it stutter (`src/player.ts`). It
reads SF3, so the compressed SONiVOX bank (`apps/k7/frontend/public/score/sonivox.sf3`, under
1 MB) is what is served, from the app's own public folder. Apache-2.0.

The view keeps no cursor bar. The notes sounding now are lit (`.score-playing`), and the column
scrolls when they leave it. A note clicked is where playback jumps to.

Lighting runs every frame, so it does as little as a frame allows: a frame sounding the notes
already lit touches nothing, the drawn pages are indexed by `data-id` once per layout rather than
searched per note, and the two rectangles the scroll needs are read before any class is written, so
no frame forces a layout of a long score. Engraving itself stays on the main thread: it runs on a
load, a transpose, a part or a zoom, never during playback.

## No Guitar Pro

Guitar Pro files are not taken. Verovio reads none, and keeping alphaTab for them would mean two
renderers, two players and two ways of transposing for one tab. A Guitar Pro file a song already
holds is listed with its name, a download and its delete, and drawn as nothing
(`packages/ui-rehearsal/src/components/SheetPanel.tsx`).

## On the Sheet tab, not a tab of its own

A score is sheet music that arrives as a file, which is exactly what the Sheet tab already
stores, uploads and deletes. A separate tab would be a second copy of that plumbing for one more
file type.

## Recognised by extension

Browsers send these files as `application/octet-stream` or `text/xml`, so the media type cannot
say what they are. `packages/rehearsal-shared/sheetKind.ts` decides from the extension and stores
the score under its own media type; the server's upload check, the Sheet tab and both exports all
ask that one module, so they cannot disagree about what a file is.

## A compressed score is opened here

An `.mxl` is a zip whose `META-INF/container.xml` names the score inside it. `src/musicxml.ts` opens
it with the browser's own `DecompressionStream`, about forty lines and no dependency, because the
view needs the score as TEXT: to list its parts and to draw one part alone. Verovio's own zip
loader would hand back neither.

## Loaded only where a score is shown

Verovio's module is about 7 MB, compiled once per page on the first score shown and reused by
every score after it (`src/engraver.ts`). `src/ScoreView.tsx` is the only module that imports
either library, and the sheet panel loads it with `import()`, so no other screen pays for them
(`packages/ui-rehearsal/src/components/ScoreSheet.tsx`). The service worker precaches that chunk
like any other, once per Verovio version, in the background, so a later open of a score starts
from disk. It is 8.2 MB against the preset's 8 MiB ceiling: a Verovio that grows past it is left
out of the precache, with only a build warning, and is then fetched on the first score shown.

## Every part, or the one you play

A score opens with all its parts stacked in one system, as a conductor's score reads.

A score with more than one part has a part menu in its toolbar, **All** first, so a musician
can read their own line alone.

| choice | why |
|---|---|
| the menu changes what is drawn, never what is played | playback stays the whole band, so the part read alone is still heard in its arrangement |
| a part with no name is "Part n" | many MusicXML exports leave `part-name` empty, and a menu of blanks says nothing |
| the choice is kept per file, not per song | another file of the same song has other parts, and an index into the first one's means nothing |

Drawing one part means loading the file with the other parts cut out (`keepPart`), since a
Verovio toolkit holds one file at a time. So the whole score is loaded first for its MIDI, then
the part for the page. The lit notes come from the file on the page, and both share one timing.

## Transposition is one setting

Verovio's `transpose`, given in semitones, moves the notes, the key signature and the MIDI written
from them. What you read is then what you hear, with no second shift to keep in step.

## Full screen is one scrolling column

A score can go full screen with its toolbar, which stays on top so play and transpose remain at
hand. The score under it is Verovio's pages laid out to the screen's width, systems wrapped and
stacked downwards, scrolled as one column that keeps the lit notes in view. There are no page
turns: on a music stand a turn is a gesture you do not have a hand for. A new width is a new
layout, so the systems wrap again when the panel or the window changes size. Only scores get
this; a PDF or an image is drawn by the browser, not by the app.

## What the exports leave out

A score is in neither the PDF nor the EPUB export. It is notation, not a page, and drawing it to
paper is a job the export does not take on.

## The player loads on the first Play

A score opens with no player. The first press of Play creates the audio context, the worklet and
the synthesizer, and fetches the soundfont: a browser starts audio only from a click, and most
scores are opened to be read, not heard. While the player loads, Play is greyed out
(`ScoreState.loading`). The soundfont is not precached, so playback needs the network the first
time a score is played.
