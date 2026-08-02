# The note grids — TrackerGrid, RollGrid, and the plugin that mounts them

Two views of the same inline `notes: [ … ]` array in a sequence file. Both are plain
DOM (they mount inside a CodeMirror widget, not the React tree), and both call back with
the WHOLE new note list, which `notes.ts` serializes straight back into the file.

## `plugin.ts` — the mounting mechanism

Find the `notes:` array and replace it, in place, with an interactive grid — the same
replace-decoration code-folding uses, so the wrapper text stays visible around it.

A grid edit dispatches a transaction rewriting the list text via `renderNotes`, which
flows through the editor's normal onChange → dirty → Save path: no new save channel, and
the file on disk is exactly what the compiler reads back.

Each view is a plain `Extension` — `EditorPane` pushes at most one, only for sequence
files — so with neither, the file is ordinary text.

## `TrackerGrid.ts` — the tracker view

A real tracker layout, not the piano roll: time runs top→bottom, one row per step (a
sixteenth), with the row index down a gutter and bar/beat lines highlighted.
Simultaneous notes spread across CHANNEL columns (a greedy voice assignment, since the
file stores no channel — just overlapping `{t,d,k}`). Each onset cell shows the note
name (`C-4`); the rows a note sustains through show a continuation tick.

It is keyboard-driven, like the trackers it apes: click to place the cursor, then the
arrows move it and the piano-key layout (z-row / q-row) types notes at it. Because the
cursor and focus must survive the widget being rebuilt after every edit, they live in a
caller-owned `ctx` the plugin keeps across rebuilds, not in this DOM.

## `RollGrid.ts` — the piano-roll view

Mounted into a standalone pane by `plugin.ts`'s `mountSeqGrid`, filling the whole editor.
Time runs left→right, pitch top→bottom, one lane per semitone. A left gutter names each
pitch (the piano keys); a top ruler numbers the bars.

The note area FILLS the pane — lanes, gridlines and notes are positioned in PERCENTAGES
of it, so it stretches both ways with the pane instead of scrolling a fixed grid. Click
an empty cell to add a one-step note; click a note to remove it.

## `notes.ts` — the read/write seam

A sequence holds its notes inline as a flat list of compact mappings —
`- { t: 0, d: 1, k: 60, v: 0.8 }` (t/d in beats, k a MIDI key, v an optional 0..1
velocity). Both grids go through here, so a grid edit round-trips to the exact text the
compiler reads back.

It works on a SPAN rather than rewriting the whole document, and that is deliberate: the
tracker dispatches a CodeMirror transaction replacing that range, which keeps the undo
history and the cursor a full-document rewrite would throw away. The parser finds the
list, and the span comes off its node range.
