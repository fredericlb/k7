# The clip editors — the piano roll, the waveform, and the step sequencer

Panes over one event: `PianoRoll` for a sequence, `WaveformView` for audio, and — when the
sequence's track feeds a RACK — `SequencerPanel`, a step sequencer. `ClipView` picks between
them and all are mounted by the same two hosts — the editor's bottom strip, and the graph slot
when a clip is clicked in the timeline (see [shell.md](shell.md)).

A MIDI clip's three readings — sequencer, piano roll, tracker — are one **view switch** in the
pane's header rather than three ways in; see [The view switch](#the-view-switch).

## The step sequencer

A MIDI clip is a list of notes, but when its signal lands on a rack the notes are not pitches —
they are SOUNDS, the rack's symbols. So the editor for that case is a grid, not a roll: one row
per rack sound (`rackFor.ts` finds the first rack downstream of the track, following the outs;
bypassed steps still count, since a muted kit still defines the vocabulary), one column per step
of the clip's window at a chosen **precision** — 1/2, 1/4, 1/8 or 1/16 notes, a closed set so
the grid never lands on a step nothing musical means, session state of the panel and written
nowhere.

### It paints first, and asks the document afterwards

A `sequence note` command costs ~400 ms on the service — it recompiles the project — and the
reload lands after that. The panel used to wait for it before lighting the cell, and to
**disable the whole grid** meanwhile, so everything pressed during that half second was dropped
in silence: that is what "slow at edition" was. Now a press paints at once and only fires the
command; the ghost is held until the document AGREES (`settledEdits`), which is the rule the
timeline already follows for a clip drag. Commands are chained rather than gated — each is a
read-modify-write of one file, so they must not overlap, but nothing has to be refused.

Two costs went with it. The grid asked `noteInCell` per cell, a scan of every note per cell —
sixteen rows of sixty-four cells over a hundred notes is a hundred thousand comparisons, redone
on every render; `notesByCell` indexes them in one pass. And a velocity drag no longer renders
at all: it moves the pressed cell's three level layers in place (`drawLevel`), the same rule the
transport line follows. A ghost is keyed `<note>@<cellIndex>`, so changing the PRECISION drops
the pending ones — an index counts cells of the step it was made at.

A lit cell is "this sound hits here". A press toggles — `sequence note new` for on,
`sequence note remove` for off — and a vertical DRAG on a lit cell is **the roll's velocity
gesture restated for a button**: the cell splits at the level (solid below, lighter above, a
white line at the value, the roll's own geometry at a fixed height), undecided until the press
travels the roll's 4px slop, committed as `sequence note velocity` on release. Every commit is
one line in the journal and one Ctrl+Z, and the grid redraws from the reload. The arithmetic is
`stepGrid.ts`, pure and tested: a cell claims any note STARTING inside it (a played take's hit
lives mid-cell and must still show, and toggling it off addresses the note at its real start,
not the cell's); the grid divides the clip's window — the same cage the roll draws — and a
window that does not divide evenly keeps its last, partial cell, whose note is clamped to fit.

**Ctrl+drag MOVES a note** to the cell it is released over — another step, another pad, or
both, since the grid is two axes of one thing. It carries the note's velocity and its length
across by construction: `sequence note move` rewrites the note's `k` and `t` and touches
nothing else, where a remove-then-add would have lost both (`sequence note new` takes no
velocity) and been two journal steps for one act. The modifier is read at the PRESS and cannot
change mid-drag, and the destination comes from the point under the cursor rather than from the
event's target — the press captured the pointer, so every release lands on the cell it started
on. A drop outside the grid, onto its own cell, or onto one that already holds a note does
nothing: (key, start) is how a note is addressed, and two on one pad would be the same note
twice. The writer refuses that last case as well, as the last word.

Keys the rack has no row for are **rows too**, not a count: they follow the rack's rows, high
first, labelled by their pitch and drawn amber — a played take with keys the kit does not name
must show, and stay editable, rather than read as data lost.

## The view switch

One clip's notes have three readings, and the header's dropdown (`ClipViewModes.tsx`) is how you
move between them. It is drawn in **all three headers**, which is the whole point: it replaced a
one-way 🎹 button on the sequencer, so leaving the grid was a click and coming back meant closing
the pane and clicking the clip again.

| mode | what it is | how it writes |
|---|---|---|
| `sequencer` | one row per rack sound, one column per step | `sequence note …` commands — one press, one Ctrl+Z |
| `roll` | the piano roll — off-grid timing, precise lengths, keys the rack does not name | the same commands |
| `tracker` | the sequence FILE as a text grid — arrows move, keys type notes | straight to the file (`SeqGridFile`) |

Two rules decide what you get:

- **The sequencer is offered only when there is a rack.** `rackFor.ts` answers that, and with no
  rack the entry is not in the menu at all rather than present and dead — there would be no rows
  to draw. The default mode is `sequencer` and falls through to `roll` when the rack is absent,
  so a clip still opens on the best view it has.
- **The mode resets per clip.** It is about what you are looking at, not a state the pane is stuck
  in; the rack is what the track IS, so the next clip opens on its own best view.

The tracker is the same grid `sequence edit tracker <sequence>` opens in the graph slot — the
file-owning half is `SeqGridFile`, mounted by both, so there is one answer to "read it, hand it to
the grid, write it back". It edits the sequence file directly where the other two go through
commands; both land in the same YAML, and the difference is only whose undo you get — the
editor's, rather than the shell's journal. A clip whose `ref` names no sequence file says so
instead of drawing an empty grid.

One consequence worth naming: the tracker reads its file **once**, deliberately, so an edit made
elsewhere needs the view reopening — refetching under a hand mid-edit is how a cursor and a
half-typed note are lost. Switching mode and back is what reopens it.

One plumbing fact this panel surfaced: the graph slot's `target` is a snapshot taken at the
click, so `ClipView` re-reads the compiled project on every `reloadKey` and re-finds the
placement by (id, start) — without that, a cell wrote its note and lit nothing, and the roll's
drags snapped back on release.

They share their pan/zoom hook (`@studio/ui-timeline/panZoom`, and
[timeline.md](timeline.md) says why a plain wheel scrolls) and nothing else about their drawing:
one draws 128 key rows, the other a canvas envelope.

## The ruler subdivides with the zoom, and the material carries its lines

Every ruler in the app draws off one ladder — `rulerScale` picks the unit from the current pixels
per beat, `RulerTicks` draws it, `Grid` repeats it one weight fainter across the material
(`Ruler.tsx`, shared with the timeline). Zooming in descends bar → beat → half → sixteenth;
zooming out thins the *numbers* while keeping the lines, so the grid never smears.

The roll was the surface that did not have this. Its own ruler — the FILE's numbering, under the
arrangement ruler — was two loops written here: bars every `barBeats`, beats every 1, at any zoom.
And the lane under it drew bar lines **only**. So the roll's ruler ticked at a fixed resolution
while its canvas zoomed, and the notes sat over a grid coarser than the ruler above them. Both
now come from `rulerScale`, at the roll's live `ppb`.

Three things fall out of sharing it, and all three were the point:

- **A position reads the same in both panes.** The timeline's bar 33 line and the roll's are the
  same line at the same weight, because one function drew them.
- **The zoom is the resolution control here too.** A click on the arrangement ruler snaps to a
  tick that was drawn, so opening the view up is how a finer position is reached — the rule
  `packages/ui-waveform/docs/ticks.md` states for every ruler.
- **The window's origin is respected for free.** The ladder counts from the coordinate's origin
  rather than the view's left edge, so a clip windowed to open at bar 3 says 3, exactly as the
  hand-rolled version had to arrange for itself.

The waveform canvas reaches the same density by a different route: its bar/beat lines arrive from
the file service as a list, so it splits what it was sent (`subdivideGrid`) instead of computing a
unit. Same threshold, so the `ArrangementRuler` over an audio clip and the wave under it agree.

### …and the roll's gestures land on those lines, unless Ctrl says otherwise

Drawing a note, moving one and stretching one all snap to `gridUnit` — the step the ruler is
drawing and the caret is walking. **Hold Ctrl and the gesture follows the pointer exactly.** The
rule, the arithmetic and the modifier are `src/snap.ts`, shared with the timeline
(`timeline.md`), so the two surfaces cannot come to mean different things.

The roll used to be free at every zoom, which made it the odd one out: the ruler drew lines, the
caret walked them, the timeline's drags landed on them, and only a note ignored them. That is a
change in what an unmodified drag does, and it is the intended one — a finer position is reached
by opening the view, and Ctrl is how the old behaviour is asked for.

Two details the timeline settled first, kept identical here:

- **The OFFSET snaps, not the resulting position.** A note played in by hand at 2.43 keeps that
  phase when you move it a beat.
- **The modifier is read live**, off each pointer event, so a note can be begun on the grid and
  finished off it.

**Drawing snaps to CELLS, not to lines**, and that difference is the roll's own. The same press
places the caret, which belongs to the cell you pointed *inside* — a floor. A note landing on the
nearest *line* — a round — would sit one cell away from the caret half the time, and the two would
disagree about where you had just clicked. So `drawSpan` starts the note at the pressed cell's
beat and ends it at the FAR edge of the last one, the way `colSpan` reads the rectangle: drag
across three cells, get three cells of note. A press that never leaves its cell still returns a
zero-length span, which is what leaves the length to the command's default — the behaviour a plain
click has always had.

`atEvent` therefore stays unsnapped, and the raw beat is what the gesture remembers. The grid is
applied where the span is READ, so Ctrl pressed or released mid-drag changes the whole answer
rather than half of it.

**In the step sequencer, Ctrl+drag means something else** — it MOVES a note to another cell (see
above). No contradiction: that grid has no free positions to reach, so there is nothing there for
Ctrl to suspend. Worth knowing before assuming one modifier means one thing across all three
views.

## The caret, and the rectangle it grows into

The timeline's caret is here too, on both grids: `hjkl`/arrows move it, `v` grows it into a
rectangle, Escape drops that, **Shift+drag** draws one with the pointer. Same keys, same marks —
a primary wash with an outline — and the same rule that the caret disappears while a rectangle is
live, because the rectangle IS the caret then, with two ends.

The arithmetic is `src/gridCaret.ts`, pure and tested; `src/hooks/useGridCaret.ts` holds the
state, the key listener and the drag. It is a **second** implementation rather than the
timeline's, and deliberately: the timeline's caret walks rows by IDENTITY (`RowKey`), has a
`LABEL` position no lane grid has, and refuses rows that cannot hold a clip. A clip editor's rows
are a dense array — 128 pitches, or the rack's sounds — so the shared thing is the behaviour, not
the code, and retrofitting one onto the other would have made both answer questions neither asks.

What a cell IS differs, and that is the whole of the per-pane work:

| pane | a row | a column |
|---|---|---|
| the roll | a pitch, top-down like the keys (`row = 127 − key`) | one step of the **ruler's current unit** |
| the sequencer | a rack sound, then the keys the rack does not name | one step of the chosen precision |

The roll's column following the zoom is the point rather than a side effect: the ladder is the
resolution control everywhere else here (`packages/ui-waveform/docs/ticks.md`), so a finer caret
is reached by opening the view, not by a second setting nobody would find. It is also why the
caret resets when the unit changes — column 12 is a different MOMENT once the step halves, and
that is not where you put it.

### The selection reaches the transport

**Shift+L loops it**, exactly as on the timeline, and that is what a rectangle over one bar of a
take is *for*. The span runs to the FAR edge of the last column (`colSpan`'s +1), so a one-cell
selection loops that step rather than nothing; with no rectangle the key clears the loop instead,
which is what makes one key both set and unset it. **`t` sends the playhead to the caret.**

Both convert through `songBeatOfCol`, and the conversion is shorter than it looks: a column's
song beat is `clip.start + col × unit`, with the grid's own origin cancelling out. Both panes draw
their first column at the canvas's left edge and stack the arrangement ruler over that same edge
starting at the placement, so a windowed clip needs no special case — its window moved the local
numbering, not where the material plays.

The three verbs arrive as **commands** (`ui select`, `transport locate`, `transport loop`), so
`App` dispatches them to whichever grid is on screen: the clip pane while it is open, the timeline
otherwise. Zoom stays the timeline's alone — the roll zooms with the wheel and keeps no stack.
`keys.ts` gained one condition, `clip_selection`, so ⇧L goes quiet with nothing to loop here for
the same reason it does there.

Two smaller rules, both the timeline's:

- **A press moves the caret**, before anything else the press does. That is what makes `v`, `t`
  and ⇧L mean the cell you just pointed at rather than one you last walked to.
- **Escape is swallowed hard** (capture phase, `stopImmediatePropagation`). Bubbling, it would
  drop the rectangle *and* be read by the shell as "close the pane" — one press doing two things.

### Copying a rectangle, and pasting it at the caret

`ui copy` (`c`) puts the rectangle's contents aside; a paste (`p`) puts them down with their
**top-left corner under the caret**. That is the whole model — the clipboard holds coordinates
relative to the corner, so where you put the caret decides both the shift in time and, on a roll,
the transposition. `src/clipboard.ts` is the arithmetic, pure and tested.

The clipboard is **one slot for both kinds**: copying is a single gesture with a single memory,
and two clipboards would make "what does paste put down" a question about which pane you copied
from three minutes ago. `ui copy` reads whichever grid is on screen, because only one rectangle is
ever live.

| copied from | what is held | pasted with | which runs |
|---|---|---|---|
| the timeline | placements, by lane offset and beat | `events paste` | `events add` |
| the roll | notes, by semitones below the top row | `sequence notes paste` | `sequence note add` |
| the sequencer | the same, through the rack's rows | `sequence notes paste` | `sequence note add` |

**Two paste verbs, not one**, for the reason `track process` and `clip process` are two: the noun
is the promise. Each names the material it puts down, so it also names the surface that answers —
events onto the timeline's caret whatever else is on screen, notes into the open clip grid — and a
paste never has to guess which pane you meant. `p` resolves to the verb for what is HELD
(`clipboard_events` / `clipboard_notes` in `keys.ts`), so the key runs the same line you could
type. A bare `paste` routed by "whichever grid is drawn" came first and was wrong in the way that
family of commands is always wrong: the first word promised nothing, and the status line was the
only place you could find out what had been pasted where.

Four rules worth knowing, each of which could reasonably have gone the other way:

- **A note or event is IN when it STARTS inside.** The rule `stepGrid`'s cells already follow, and
  the only one that makes a rectangle's contents well defined — taking them by overlap would copy
  the same note into two adjacent rectangles.
- **A note's LENGTH is carried whole, uncut by the edge.** A copy is of the material; the rectangle
  says which notes, not how long they are.
- **What does not fit is DROPPED, not clamped.** A chord squashed onto key 0 is not the chord you
  copied, and a rectangle three lanes tall pasted onto the last lane does not fold its lower two
  onto it. The status line says how many were left.
- **A paste is ONE command**, so it is one journal entry and one Ctrl+Z whatever it contained. The
  pane hands the shell a command *line* rather than writing; `events add` exists for this, the
  bulk counterpart of `sequence note add` (`packages/commands/docs/`).

`ui copy` is a `ui` command because the clipboard is the shell's and no file moves. **Both pastes
are bare-named**, because they write — the line that namespace draws, the same one `event move`
and the file-tree verbs sit on the far side of.

## A clip with a window is CAGED to it

A clip that states `from`/`to` shows that interval and **nothing else** — outside it is not drawn,
not scrollable-to, not clickable:

- the **roll** (`src/rollFit.ts`): the canvas spans the window. Notes wholly outside do not exist
  on screen; a note over the edge is drawn at its true beats and cut where the window ends
  (`overflow-hidden` on the lane is the cage's edge). The header counts what the cage hides —
  `4 notes (+2 hors fenêtre)` — so a windowed file does not read as data lost. The grid stays
  **absolute**: a window opening at bar 3 says 3, not 1. The later passes of a looped clip are the
  same picture again, so the canvas stops at the window's end, and the playhead **folds** back into
  the window (`localBeat % win`) instead of walking off along the placed extent.
- the **audio clip panel** (`AudioClipPanel`, the pane a click on an audio event opens): the
  bar-window arithmetic (`src/barWindow.ts`) takes the clip's interval, so the twelve-bar default,
  the anchored zoom and the "tout" button all move inside `from`/`to`. It still asks the service
  for the WHOLE file (`whole`), so onset seconds stay file-absolute; only the view is caged.

The one deliberate exception is **`WaveformView` in `whole` mode** — the strip a `clips/*.yaml`
opens in the editor. Its entire purpose is to show the file the window is judged against, and it
is where the `from`/`to` handles live; caging it would leave nothing to drag them over.

## What the roll OPENS on, without a window

`src/rollFit.ts`, and both axes work the same way: frame what is **used**, with a 20% margin, and
let the canvas run to the placed extent — the later passes are there to be scrolled to. The pitch
axis had always done that — the used range ±20%, clamped to the 128 keys that exist; the time axis
had regressed to framing `[0, clip.length]` and was measured back into shape on LEMO - DANSE
(`bs.verse/bass_2_3`, 16 beats of notes placed 35 long, opened at 38% full; it opens at 83%, the
1/1.2 the margin implies). With a window the fit question disappears: the view IS the window, and
the pitch fit reads only the notes the window contains.

### A different clip opens at fit, zoom included

`useHZoom` holds its multiplier in state and nothing let go of it, so a clip opened after a zoomed
one inherited the previous one's scale — the other half of "it does not open on its content", and
the half no fit arithmetic could fix. Both panes now reset it on the clip's identity.

The roll's framing effect waits for that reset (`if (zoomX !== 1) return`): on the commit that
changes `clip.id`, `ppb` still carries the old multiplier, and scrolling by it lands somewhere else
entirely.

### "A different clip" is not the same question as "different MATERIAL"

The waveform's fetch hung on `clip.id`, which is exactly the thing a trim does not change: `clip
trim` rewrites the clip file's `from`/`to` and leaves the placement alone, so the pane kept
drawing the material it had before. It depends on `clipEnvelopeKey` now — the same key the
timeline's envelope cache is filed under, so the pane and the blocks behind it cannot disagree
about what a clip currently plays. `docs/timeline.md` ("Activity runs through the blocks") holds
the reasoning and lists what is still stale until a reload.

A trim therefore re-fits the pane, like opening another clip does. That is the honest reading:
the region really is a different one.

## The loop marks

`src/clipLoop.ts` is the arithmetic, shared so the panes cannot disagree: the window that
repeats, how many passes fit the placed length, and where each later pass begins. **The roll no
longer draws any of it** — its canvas IS the window now, so a band would frame everything and mark
nothing; only its header still states the loop and its pass count in words. The waveform strip
(`WaveformView`, outside `whole` mode) still spans the placed length and draws the marks in violet
— a hue it had not spent (yellow transients, blue warp marks, `primary` slice windows) — as a
tinted band with its two edges picked out and a fainter line per repeat.

**The two axes have different origins, and the compiler states the loop in whichever space its own
material lives in** (`packages/song/docs/alternatives.md` is not this; the fields are set in
`nodeProject.ts`). That difference is the whole reason this is a module and not two inline sums:

| | what `loopStart`/`loopEnd` mean | where the window is drawn |
|---|---|---|
| midi | positions in the NOTES | at `loopStart` — the same axis the roll puts note times on |
| audio | beats into the SOURCE | at 0 — the region is drawn from the clip's in-point, which is where the window starts |

Read an audio clip's `loopStart` as an x position and every mark lands off the right of the pane,
by the in-point. `clipLoop.test.ts` pins both readings.

Two smaller rules:

- **`visibleRepeats` is asked, not assumed.** A 1/4-beat window in a 64-beat clip is 256 passes;
  at any zoom that fits the clip those lines sit on top of each other, and a solid violet block is
  not information. The pane knows its own pixels per beat, so it decides — the window's own two
  edges are never dropped.
- **Nothing is drawn in `whole` mode.** That view spans the source file rather than the placement,
  so the audio window's `0` would mark the head of the file instead of the loop. What that view is
  about is the material's own `from`/`to`, which `sliceRanges` already shades.

## The material's window — a different thing from the loop

`from`/`to` say which span of the source the clip IS. The loop says how many times that span is
played. They coincide for MIDI and are stated in one pair, which is why `clipLoop` reads
`loopStart`/`loopEnd` for both — but the drawing question is not the same one, and the surfaces
answer it two ways:

| | how the window shows |
|---|---|
| `WaveformView` (a clip file in the editor, `whole`) | shaded over the whole file, from the TEXT, live as you type — the view the window is JUDGED in |
| `AudioClipPanel` (clicking an audio event) | it is the view: the pane is caged to `sourceWindow` |
| the roll, placed sequence or `sequences/*.yaml` | it is the view: the canvas is caged to the pair |
| the tracker and the inline grids | the band, drawn as ground under the notes |

Where it is still a band it is deliberately colourless — a white wash with its two edges picked
out. These panes already spend violet on a selection, blue on a warp, teal on a marker, emerald on
a note; a seventh hue for the thing all of those sit *inside* would compete with every one of them.

### `whole` was cropping the picture it was shading

`regionWaveform` opens its region at `sourceFrom` and blanks whatever lies past `sourceTo` — right
for a placement, and wrong for the one view whose whole purpose is to show the file the window is
judged against. `clip trim` writes SECONDS, and `mapClip` reads exactly those, so trimming a clip
silently redrew the pane as the trim itself: the head gone, the tail flat, and no way left to see
what had been cut or to judge putting it back.

A **timecode** window escaped it — `Number("2:1")` is `NaN`, so `mapClip` skipped the field — so one
field's two spellings drew two different pictures. `WaveformOps` now draws the whole view windowless
and reports the window separately, which repairs both panes at once: `WaveformView`'s own overlay
was measuring `from / wf.seconds` from the crop's zero, i.e. shading the wrong span of an already
wrong picture.

### …and the timecode spelling had no window to shade at all

The same `Number(c.from)` is why the band did not appear on a real song. `nodeProject` has always
resolved both spellings; `mapClip` — the path `loadAudioClipDoc` takes, and therefore the one the
`whole` view reads — resolved only numbers, so a timecode edge produced a clip with **no window**.
Measured on 01.danse.l8, four of five sampled clips are written `to: "3:1"` and came back empty;
only the one trimmed by `clip trim`, which writes seconds, had anything to draw.

`loadAudioClipDoc` now takes the project's grid and resolves the edge the way the compiler does.
Without a grid it still drops a timecode rather than guessing, which is exactly what it did before,
so the preview callers that pass none are unchanged — they read only `source` anyway.

The window rides on the payload in the same display seconds as the onsets and the warp marks, mapped
through `RegionWaveform.toDisplay` — the region's own projection, handed out rather than copied. A
second `(sec - inPoint) * stretch` elsewhere is exactly how a band comes to sit a pixel off the marks
beside it.

## Velocity, on the note itself

A horizontal line inside each note: at its bottom edge for 0, at its top for full. It is **half the
note's width and centred**, so it reads as a mark ON the note rather than as one of its edges — a
full-width rule at the top of a note is indistinguishable from the note's own border.

The note is also **split** at that line: solid below it, 80% above. So a row of notes reads as
levels at a glance, before the lines themselves are looked for, and a note too short to hold a line
at all still says what it is worth. The fill colour lives on the two halves rather than on the box,
which is what makes "80%" mean the note's own colour and not a wash of whatever is behind it.

Dragging the note up or down moves the line and, on release, runs `sequence note velocity` — the
same shape as the timeline's clip drag, where the gesture is the view's and the commit is a command.

Four things worth knowing:

- **The units are the file's, 0..1** (`NoteSchema`'s `v`), not 0..127. The geometry is the MIDI one
  — low at the bottom — but nothing here invents a second scale for a value the file states.
- **Absent means 1.** `toWebTracks` sends `vel` only when the file said one *and* it is not 1, and
  the command CLEARS the field at 1 rather than writing the schema's own default back into a file
  that never mentioned it. So a sequence nobody has touched stays byte-identical, and a roll can
  tell "full" from "unstated" — which is the same distinction, drawn the same way.
- **The note is the handle.** There is no separate grip: at a typical row height of 20–40px a
  handle inside the note would be a few pixels tall. The consequence is that a press on a note no
  longer bubbles to the lane's draw-a-note gesture — no loss, since two notes cannot share a key
  and a start, but it is the thing to remember if that gesture is ever wired up (App does not pass
  `onCreateNote` today, so the roll's drawing is unreachable from the shell).
- **A press that never moves commits nothing.** A stray click on a note must not silently rewrite
  what it is worth.

The live value lives in a **ref**, with state only for what to draw: firing the command from inside
a `setState` updater would run it twice under StrictMode's double invocation — a velocity written,
then written again.

Velocity had to be added to the wire to draw it at all: `WebNote` carried `time`, `duration` and
`key`, and the compiler's `vel` stopped at `toWebTracks`.

## What is deliberately NOT drawn

In the caged panes — the roll and the audio clip panel — the area outside the window is not drawn
**at all**: what does not play is not on screen, which is the strongest possible statement of it.
In the panes that still show more than the window (the tracker, the inline grids, `WaveformView`'s
whole view), the outside is not dimmed either — the band lights what plays rather than greying
what does not, because for a repeated clip the pane past the window is not silence, it is the next
pass, and one rule that reads as "this does not play" would be wrong in the commoner case.
