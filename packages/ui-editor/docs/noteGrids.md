# The note grids — TrackerGrid, RollGrid, and the plugin that mounts them

Two views of the same inline `notes: [ … ]` array in a sequence file. Both are plain
DOM (they mount inside a CodeMirror widget, not the React tree), and both call back with
the WHOLE new note list, which `notes.ts` serializes straight back into the file.

## `plugin.ts` — the mounting mechanism

Two mountings, and only the second has callers.

**`mountSeqGrid(container, opts)`** renders a grid into a plain filling element, with no
CodeMirror anywhere near it. It takes the file's content and hands back the WHOLE next
content with the note list rewritten, and re-rendering is driven from OUTSIDE it
(`controller.update`) — so an edit and an external reformat share one path, with no
re-entrant rebuild in the middle of an event. This is what every host uses.

**`rollGridPlugin` / `trackerPlugin`** are the same grids as CodeMirror `Extension`s,
replacing the `notes:` array *in place* with a replace-decoration so the wrapper text
stays visible around it. Nobody calls them (see `docs/inventaire.md`). They are kept
because that property — the YAML around the grid still readable — is one `mountSeqGrid`
does not have, so this is a question of who calls, not of whether it works.

## Where a host puts them

This package renders a grid; it decides nothing about where. In l8 there are three homes,
and the split is deliberate:

| where | what persists an edit |
|---|---|
| the **chains slot** in the main view, opened by `sequence edit roll\|tracker <sequence>` and closed by its × | written straight to the file, per edit |
| the **editor popin's tabs** — Text / Roll / Tracker, on a sequence | into the editor's buffer: dirty flag, Save button, one path with the text |
| st0 / anywhere else drawing a sequence | its own |

The fullscreen editor pane has neither, on purpose: it is the text editor, and a grid
wants the room the main view has. See `apps/l8/frontend/docs/shell.md`.

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

Mounted into a standalone pane by `plugin.ts`'s `mountSeqGrid`, filling whatever it is
given. Time runs left→right, pitch top→bottom, one lane per semitone. A left gutter names each
pitch (the piano keys); a top ruler numbers the bars.

The note area FILLS the pane — l8, gridlines and notes are positioned in PERCENTAGES
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
