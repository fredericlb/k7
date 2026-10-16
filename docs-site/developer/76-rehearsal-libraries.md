# Recorder, lyrics, tablature, score

Five small packages sit under the rehearsal screens. Each keeps its logic pure and testable
without a DOM, with the React component a thin layer on top.

## `@studio/rehearsal-shared`

`packages/rehearsal-shared`: what both the server and the screens must agree on. Two answers to one
of these questions would mean, for example, a public link playing a version the owner never picked.

| Export | File | What it decides |
|---|---|---|
| `.` | `types.ts` | `Session`, `Moment`, `Release`, `ReleaseVersion`, `Page`, `Song`, `SheetFile`… |
| `./pageVersion` | `pageVersion.ts` | Which version a page plays (its choice if present and not hidden, else the default) and which a visitor may pick |
| `./pageVisibility` | `pageVisibility.ts` | `private`, `authenticated`, `public`, narrowest first |
| `./sheetKind` | `sheetKind.ts` | Whether a sheet file is a PDF, an image or a score. Scores are recognised by extension (`.musicxml`, `.xml`, `.mxl`, `.gp`, `.gpx`, `.gp3`–`.gp5`), since browsers send them as `application/octet-stream` |
| `./epub` | `epub.ts` | What goes into a song's EPUB: Lyrics, Tablature, and image sheets; PDFs and scores are left out |
| `./naming` | `naming.ts` | Export file names: `Artist - Title`, unique with `-2`, `-3`; the zip's dated name |
| `./youtube` | `youtube.ts` | Whether a demo link is a YouTube link (checked by the form and by the route) |

Tests: `npm test -w @studio/rehearsal-shared` (`pageVersion`, `sheetKind`, `youtube`).

## `@studio/recorder`

`packages/recorder`: taking a take in the browser.

- `src/useRecorder.ts`: `MediaRecorder` over the input stream, a loudness sample every 200 ms
  building the envelope live, pause and resume with elapsed time excluding pauses, auto gain
  (the loudest moment aimed at 0.9, about -1 dBFS, capped at 32×; a playback normalisation, the
  file is untouched), a screen wake lock re-requested when the tab becomes visible again, and
  `fix-webm-duration` on the result. `acquireMicrophone` and `describeMicError` map browser
  failures to the five messages the host translates.
- `src/detect.ts`: the backend's highlight detector, ported to run live. Silence is two seconds or
  more under a threshold (15% of peak by default); events under four seconds are dropped.
- `src/takeBackup.ts`: every chunk written to IndexedDB as it is recorded; `listBackedUpTakes`,
  `readBackedUpTake`, `forgetTake` hand them back after a crash. Best effort: no IndexedDB or a full
  quota means no backup, never a broken take.
- `src/RecorderView.tsx`: the recorder UI (live waveform, highlights, tagging, metronome, the
  two-second hold to stop, Space to hold). `src/LiveWaveform.tsx`, `src/MomentPlayer.tsx`,
  `src/TagInput.tsx`. The static waveform is `@studio/ui-waveform`.
- `src/useMetronome.ts`: a click scheduled on its own `AudioContext`.
- `src/labels.ts`: English defaults (`RECORDER_LABELS_EN`, `MIC_ERRORS_EN`); the host passes its
  own (`packages/ui-rehearsal/src/recorderLabels.ts`).

The package has no test script.

## `@studio/lyrics`

`packages/lyrics`: chord sheets.

- `src/chords.ts`: classifies lines (chord line, lyric with inline `[C]`/`(Am)` chords, section
  label `[Verse]`/`(Chorus)`/`{Bridge}`/`Chorus:`, tab line), recognises chords against a KNOWN
  vocabulary of qualities so that "Bad" is not a chord, transposes (root and slash bass only,
  keeping the whitespace between tokens), and handles inline timecodes `{{MM:SS}}` or
  `{{MM:SS.cc}}` (`TIMECODE`, `stripTimecodes`, `timecodeOf`, `formatTimecode`).
- `src/lrc.ts`: parses LRC (multiple stamps per line, word stamps, `[offset:]`) and matches its lines
  to a sheet's lines by normalised text and Levenshtein distance (`TIMECODE_THRESHOLD` 0.5), then
  writes the times into the sheet as `{{MM:SS.cc}}`. The LRC spelling `[01:23.45]` is not used in a
  sheet because it reads as an inline chord or a section label.
- `src/ChordSheet.tsx`: the renderer, with transposition, clickable chords, the active line and
  clickable timed lines.

The server side of LRCLIB is `packages/rehearsal-server/src/lrclib.ts` (it sends the User-Agent
LRCLIB asks for, so the browser never talks to a third party).

Tests: `npm test -w @studio/lyrics` (`chords.test.ts`, `lrc.test.ts`).

## `@studio/tablature`

`packages/tablature`: `src/tab.ts` parses ASCII tab into systems of strings (column index maps to x
position, since tab is monospace), sections and text; `src/Tablature.tsx` draws them in SVG.
Tests: `npm test -w @studio/tablature` (`tab.test.ts`).

## `@studio/score`

`packages/score`: MusicXML and Guitar Pro through `@coderline/alphatab`.

- `src/ScoreView.tsx` is the ONLY module importing alphaTab, and is loaded lazily by the Sheet tab
  (`packages/ui-rehearsal/src/components/ScoreSheet.tsx`). It renders in page layout with the
  synthesizer player. Transposition is one setting for display and playback together; drum tracks
  are not shifted.
- `src/controls.ts` (exported from `.`): transposition clamped to ±12, zoom steps 0.5 to 2.

Tests: `npm test -w @studio/score` (`controls.test.ts`). `src/ScoreView.stories.tsx` is a
Storybook story.
