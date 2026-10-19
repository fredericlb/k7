# The note grids — TrackerGrid, RollGrid, and the plugin that mounts them

Two views of the same `notes([ … ])` list in a sequence file. Both are plain DOM, outside
the React tree, and both call back with the WHOLE new note list, which `notes.ts` writes
back into the file.

## `plugin.ts` — the mounting mechanism

**`mountSeqGrid(container, opts)`** renders a grid into a plain filling element, with no
CodeMirror anywhere near it. It takes the file's content and hands back the WHOLE next
content with the note list rewritten, and re-rendering is driven from OUTSIDE it
(`controller.update`) — so an edit and an external reformat share one path, with no
re-entrant rebuild in the middle of an event. This is what every host uses.

There is no in-place mounting — a grid replacing the `notes` list inside the text editor,
the text around it still readable. A host wanting that property builds it on `mountSeqGrid`.

## Where a host puts them

This package renders a grid; it decides nothing about where. In k7 there are four homes,
and the split is deliberate:

| where | what persists an edit |
|---|---|
| the **chains slot** in the main view, opened by `sequence edit roll\|tracker <sequence>` and closed by its × | written straight to the file, per edit |
| the **clip pane's `tracker` mode**, one of the three the header's view switch offers | the same, and the same code: both mount `SeqGridFile` |
| the **editor popin's tabs** — Text / Roll / Tracker, on a sequence | into the editor's buffer: dirty flag, Save button, one path with the text |
| the médiathèque / anywhere else drawing a sequence | its own |

The first two share `SeqGridFile` rather than each reading and writing the file themselves:
"read it, hand it to the grid, write every edit back" is one behaviour, and two copies of it
is how the two homes come to disagree about when a file is re-read.

It re-reads when the project moves — an undo, a command, a MIDI pass rewriting the same sequence —
because a grid that kept its first read would write that stale snapshot back over them on the next
cell edit. Never under a hand, though: not while a write is in flight, and not within a second of
an edit. And its writes go one at a time, since two whole-file writes in flight can land the older
one last. What is NOT shared is the
frame — `SeqGridPane` draws the sequence's own bar, the clip pane draws its view switch. See
`apps/k7/frontend/docs/clipEditors.md`.

The fullscreen editor pane has neither, on purpose: it is the text editor, and a grid
wants the room the main view has. See `apps/k7/frontend/docs/shell.md`.

## `TrackerGrid.ts` — the tracker view

A real tracker layout, not the piano roll: time runs top→bottom, one row per step (a
sixteenth), with the row index down a gutter and bar/beat lines highlighted.
Simultaneous notes spread across CHANNEL columns (a greedy voice assignment, since the
file stores no channel — just overlapping `{t,d,k}`). Each onset cell shows the note
name (`C-4`); the rows a note sustains through show a continuation tick.

It is keyboard-driven, like the trackers it apes: click to place the cursor, then the
arrows move it and the piano-key layout (z-row / q-row) types notes at it. Because the
cursor and focus must survive the widget being rebuilt after every edit, they live in a
caller-owned `ctx` that `mountSeqGrid` keeps across rebuilds, not in this DOM.

## `RollGrid.ts` — the piano-roll view

Mounted into a standalone pane by `plugin.ts`'s `mountSeqGrid`, filling whatever it is
given. Time runs left→right, pitch top→bottom, one lane per semitone. A left gutter names each
pitch (the piano keys); a top ruler numbers the bars.

The note area FILLS the pane — so gridlines and notes are positioned in PERCENTAGES
of it, so it stretches both ways with the pane instead of scrolling a fixed grid. Click
an empty cell to add a one-step note; click a note to remove it.

## `notes.ts` — the read/write seam

A sequence holds its notes as a flat list of chains, one per line —
`t(0).d(1).k(60).v(0.8)` (t/d in beats, k a MIDI key, v an optional 0..1 velocity) — or in
the short form `notes("c4 d4 ~ e4")`. Both grids go through here, so a grid edit round-trips
to the exact text the compiler reads back.

`readSequence` reads the notes EXPANDED, so a short form shows on the grid like any list.
`writeNotes` hands the grid's list to `@studio/song-schema`'s `editSequence` and makes the
file's data equal it with the fewest edits (`applyIn`): one note moved is one line changed,
and the comments, the `use_rack` and the window around the list are never rewritten. A short
form stays while it still expands to the grid's notes, and is written out in full the moment
it does not — writing it back would undo the edit.

## The window both grids draw

A sequence's `from`/`to` say which span of its notes actually PLAYS. Both grids light that
span as ground — the roll as a band behind the lanes, the tracker as one shade lighter on
the rows inside it — with its two edges picked out.

Three things about how it gets there:

- **It is read from the whole document, not from the notes array**, like `use_rack`: the
  pair sits outside the list. `seqWindowFromText` in
  `@studio/song-schema` is the reader, called on every render, since editing `from`
  changes neither the notes nor the rack.
- **The window joins the content span.** A `to` reaching past the last hit is a pad, and a
  grid that stopped at the notes would clip the very edge that explains the silence after
  them.
- **At 4/4, like everything else in these two files.** Their bar lines, their rulers and
  the tracker's PageUp all assume it already; reading the meter here alone would put the
  band on a grid drawn to another one.

The tracker's edges are inset SHADOWS rather than borders: these rows have a fixed height,
and a border would add to it and walk the whole grid a pixel down.

## A pad's effects survive a grid edit

`notes.ts`'s own `Note` is `{ t, d, k, v? }`. A sequence's schema has two fields more —
`repeat` and `skip`, a pad's effects (`packages/song/docs/padEffects.md`) — and since these
grids call back with the WHOLE list, a write that took the list as given would strip them from
every pad on the first click.

So `writeNotes` carries them: each note the grid hands back takes the effects of the note that
started on the same key at the same beat. A note the grid MOVED loses them: the grid hands back
a list and no identity, and key and onset are the only address a note has in it.
