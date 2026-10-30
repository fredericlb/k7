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
of the clip's window at a chosen **precision** — 1/2, 1/4, 1/8, 1/16 or 1/32 notes, a closed set so
the grid never lands on a step nothing musical means, session state of the panel and written
nowhere.

A vertical line marks each bar, in the gap before its first step. It is an overlay placed as a
share of the grid's width — the playhead's own rule — and not a divider between buttons: a divider
would widen every bar by its own width, and the playhead, which knows nothing of it, would drift
a little further off the music with every bar it crossed.

### It paints first, and asks the document afterwards

A `sequence note` command costs ~400 ms on the service — it recompiles the project — and the
reload lands after that. So a press paints at once and only fires the command; the ghost is held
until the document AGREES (`settledEdits`), which is the rule the timeline follows for a clip
drag. Waiting for the reload before lighting the cell means disabling the whole grid for that
half second and dropping everything pressed during it in silence. Commands are chained rather
than gated — each is a read-modify-write of one file, so they must not overlap, but nothing has
to be refused.

Two costs are avoided the same way. `notesByCell` indexes the notes in one pass, where asking
`noteInCell` per cell is a scan of every note per cell — sixteen rows of sixty-four cells over a
hundred notes is a hundred thousand comparisons, redone on every render. And a velocity drag does
not render at all: it moves the pressed cell's three level layers in place (`drawLevel`), the same
rule the transport line follows. A ghost is keyed `<note>@<cellIndex>`, so changing the PRECISION
drops the pending ones — an index counts cells of the step it was made at.

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

**Dragging the rectangle MOVES everything it holds**, by the rows and steps between the cell
pressed and the cell released over (`planSelectionMove` in `stepGrid.ts`). No modifier: a press
INSIDE a live rectangle is that gesture, and a press that never leaves its cell is still a click —
it places the caret and toggles the pad, as anywhere else. What a selected pad gives up is the
velocity drag; the rectangle is dropped with a click first when a level is wanted. Rows are rack
SOUNDS in the rack's order, so two rows down is not two semitones: each note is sent to the row
`d` below its own and the command carries every destination (`sequence notes move`). Each note
keeps its nudge inside its step. The drop is refused, with the reason in the status line, when a
note would leave the grid or land on a pad that is not itself moving — landing where another
selected note leaves is fine, so a run shifted by one step moves. It is ONE command, so one
Ctrl+Z, the pads are painted at once like every other gesture here, and the rectangle follows the
notes. While dragging, the status line says what the drop would do, updated only when the cell
under the pointer changes: a grid of a thousand buttons is not redrawn per pointer event.

### Shift+wheel NUDGES the pad under the cursor

One notch is a **hundredth of the sequence's own step** — at 1/16 and 120 bpm, 1.25 ms. The grid
says which step a hit is on; the nudge says how it sits against it, which is the whole of a
groove. The value is drawn top-right of the pad, in hundredths, and only when there is one: a
grid of zeroes would be noise over the thing it annotates.

**Bounded by the pad's own step, 0..99**, and that bound is the gesture rather than a limitation.
A note that left its step would be on ANOTHER step: the pad would vanish from under the cursor
mid-turn and the next notch would fall on an empty cell. To place a hit just *before* a beat,
nudge the pad on the step before it — 95 hundredths of the previous step is five hundredths
early, and the pad you are turning stays where your hand is.

Two things it does differently from every other gesture here, both because a wheel is a stream
rather than an act:

- **The command waits for the wheel to stop** (250 ms). A press is one command and a drag commits
  on release, but a flick is twenty notches, and each `sequence note` recompiles the project. So
  the pad is painted per notch and written once — one line in the journal, one Ctrl+Z for the
  gesture a hand actually made.
- **The ghost carries the nudge**, so the next notch reads where the last one put the note rather
  than where the document still says it is, and the command that finally goes addresses the note
  by where it is NOW.

Shift, because a bare wheel scrolls a grid that is usually wider than its pane. React binds
`onWheel` on the element, where it is not passive, so `preventDefault` holds — the same reasoning
the audio clip panel's zoom states.

Keys the rack has no row for are **rows too**, not a count: they follow the rack's rows, high
first, labelled by their pitch and drawn amber — a played take with keys the kit does not name
must show, and stay editable, rather than read as data lost.

## The view switch

One clip's notes have three readings, and the header's dropdown (`ClipViewModes.tsx`) is how you
move between them. It is drawn in **all three headers**, which is the whole point: a one-way
button out of the grid would make leaving it a click and coming back a matter of closing the pane
and clicking the clip again.

| mode | what it is | how it writes |
|---|---|---|
| `sequencer` | one row per rack sound, one column per step | `sequence note …` commands — one press, one Ctrl+Z |
| `roll` | the piano roll — off-grid timing, precise lengths, keys the rack does not name | the same commands |
| `tracker` | the sequence FILE as a text grid — arrows move, keys type notes | straight to the file (`SeqGridFile`) |

### The roll's key column names a rack's keys

On a lane that reaches a rack, a key the rack fires is labelled with what it plays — the sample's
file name, else its clip, else its symbol (`rackKeyNames` in `rackFor.ts`) — and every other key
with its note name, since there the roll is read key by key rather than by octave. The column
widens to make room. A lane with no rack keeps the plain keyboard: octave Cs only, as a pitch
reader expects.

### ×2, beside the switch

`SeqDoubleButton.tsx`, in the sequencer's header and the roll's: the sequence twice as long, its
notes played twice. One component in two headers rather than the same twelve lines in each,
because a button drawn in both has to mean the same thing in both — and it is a `sequence double`
command like every other edit here, so it is one Ctrl+Z and reachable from the bar.

On a clip that LOOPS, it halves the passes as it doubles the window: four passes of one beat
become two of two, so the same span plays and the two halves can now differ — which is the whole
reason to press it on a loop. A placement it cannot follow (an odd number of passes, or a window
of its own) is left alone and NAMED in the status line, because that one just got twice as long.
`packages/song-edit/docs/sequenceLoops.md` is the page.

It is **the one edit in these headers that is about the sequence** rather than about a note or a
pad, which is why it sits with the view switch rather than among the precisions. What a "length"
is — the stated window, else the notes' extent rounded up to the bar — is decided in the writer,
and `packages/song-schema/docs/noteEdits.md` is where that reasoning lives.

The roll draws it only when the roll can be EDITED (`onCreateNote`, the same signal its "drag to
draw" hint follows): a frozen share draws the notes and takes none, and a ×2 there would be a
button that reports a refusal. The tracker has no ×2 — it writes the file directly rather than
through commands, so the button would be the one control in that header that goes the other way.

Two rules decide what you get:

- **The sequencer is offered only when there is a rack.** `rackFor.ts` answers that, and with no
  rack the entry is not in the menu at all rather than present and dead — there would be no rows
  to draw.
- **Every MIDI clip opens on the roll**, a rack's included: the roll shows what was PLAYED, timing
  and length and velocity as they are, where the sequencer's steps quantise the picture. The
  sequencer is one pick away in the header's dropdown.
- **The mode resets per clip.** It is about what you are looking at, not a state the pane is stuck
  in, so the next clip opens on the roll again.

The tracker is the same grid `sequence edit tracker <sequence>` opens in the graph slot — the
file-owning half is `SeqGridFile`, mounted by both, so there is one answer to "read it, hand it to
the grid, write it back". It edits the sequence file directly where the other two go through
commands; both land in the same k7x, and the difference is only whose undo you get — the
editor's, rather than the shell's journal. A clip whose `ref` names no sequence file says so
instead of drawing an empty grid.

One consequence worth naming: the tracker reads its file **once**, deliberately, so an edit made
elsewhere needs the view reopening — refetching under a hand mid-edit is how a cursor and a
half-typed note are lost. Switching mode and back is what reopens it.

One plumbing fact: the graph slot's `target` is a snapshot taken at the click, so `ClipView`
re-reads the compiled project on every `reloadKey` and re-finds the placement by (id, start) —
without that, a cell writes its note and lights nothing, and the roll's drags snap back on
release.

They share their pan/zoom hook (`@studio/ui-timeline/panZoom`, and
[timeline.md](timeline.md) says how a mouse wheel is told from a trackpad slide — one zooms, the
other pans) and nothing else about their drawing: one draws 128 key rows, the other a canvas
envelope.

## The ruler subdivides with the zoom, and the material carries its lines

Every ruler in the app draws off one ladder — `rulerScale` picks the unit from the current pixels
per beat, `RulerTicks` draws it, `Grid` repeats it one weight fainter across the material
(`Ruler.tsx`, shared with the timeline). Zooming in descends bar → beat → half → sixteenth;
zooming out thins the *numbers* while keeping the lines, so the grid never smears.

The roll draws its BAR lines solid and opaque, and its beat lines dashed a step below them
(`strongBars`), where the timeline keeps both faint: rows of notes swallow a faint line that a
lane's few events leave visible, and bars and beats are what a part is read by.

The roll's own ruler — the FILE's numbering, under the arrangement ruler — and the grid on the
lane under it both come from `rulerScale`, at the roll's live `ppb`. Written here instead, as two
loops (bars every `barBeats`, beats every 1, at any zoom) with bar lines **only** beneath them,
the ruler ticks at a fixed resolution while the canvas zooms and the notes sit over a grid coarser
than the ruler above them.

Three things fall out of sharing it, and all three are the point:

- **A position reads the same in both panes.** The timeline's bar 33 line and the roll's are the
  same line at the same weight, because one function drew them.
- **The zoom is the resolution control here too.** A click on the arrangement ruler snaps to a
  tick that was drawn, so opening the view up is how a finer position is reached — the rule
  `packages/ui-timeline/docs/ticks.md` states for every ruler.
- **The window's origin is respected for free.** The ladder counts from the coordinate's origin
  rather than the view's left edge, so a clip windowed to open at bar 3 says 3, without the
  surface arranging for it.

The waveform canvas reaches the same density by a different route: its bar/beat lines arrive from
the file service as a list, so it splits what it was sent (`subdivideGrid`) instead of computing a
unit. Same threshold, so the `ArrangementRuler` over an audio clip and the wave under it agree.

**The roll's zoom has no ceiling you can reach**, for the same reason the timeline's has none —
one `useHZoom`, one derived limit, and tick layers that build only the lines on screen. The roll
passes its own scroller to both. See `timeline.md`.

### Both edges of a note stretch it, as both edges of an event do

`sequence note timerange` takes a new start AND a new end, which is what lets one verb carry three
grips: the left edge moves the start and leaves the end, the right edge moves the end and leaves
the start, the body moves both. Three grips on one verb — the same arrangement the
timeline's events have, in the same vocabulary (`mode: "move" | "start" | "end"`, the timeline's
`edge`), so the two panes cannot come to mean different things.

The rules are the timeline's too, and for its reasons:

- **an edge may not cross the other.** The floor is `MIN_NOTE_BEATS`, a 64th — short enough to be
  a real choice, long enough that a note dragged to nothing does not vanish from the roll;
- **the offset is measured from the grab**, never from where the edge is now: added to the live
  value it would be re-applied on every `pointermove` and the edge would run away from the cursor;
- **a drag that ends where it began writes nothing.**

The grips are BOXES — two six-pixel strips, one per edge — and not a hit-test on the press, which
is what lets the cursor say where the handle is *before* you commit to the drag. They are the last
children of the note, so on one narrower than two grips they cover the body and the right one wins
the overlap: the timeline resolves that same collision the same way, its handles being DOM siblings
with the right one painting last. Invisible, deliberately: the note's own edge is the mark, and a
pair of drawn tabs on every note in a dense roll would be all you could see.

`tSpan` answers where a drag has taken the note, and **the ghost and the commit both read it** —
two copies of that arithmetic is a preview that lands somewhere else than the write. It lives in
`src/rollDrag.ts` with `drawSpan` and `velAt`, the three answers that decide what a gesture
writes, pulled out of the component for the reason `rollFit`, `snap` and `stepGrid` were: nothing
here mounts a component, so arithmetic left inline in one is arithmetic no test can reach.

### The roll has three modes, and `select` is the default

`rollMode.ts`: `select`, `create`, `remove` — and a fourth, `takes`, which is a VIEW rather than a
gesture and is described below. They are the roll's own rather than the timeline's
tools — what a lane holds here is NOTES, so creating and removing are the two acts, and neither
means anything on a track. A 32px column of icons down the pane's left edge is the third way to
one, beside the keys and the bar, and the only one a finger has; each button dispatches
`ui roll <mode>` rather than setting the state beside it.

| mode | a press on a bare lane | a press on a note |
|---|---|---|
| `select` | frames — the `v` rectangle, drawn with the pointer | moves, stretches, sets its velocity |
| `create` | draws a note | **lets the press through** to the lane, which draws |
| `remove` | places the caret | `sequence note remove` |

**`select` is the default**, so a bare drag frames rather than draws a note: the roll opens ready
to READ. Shift still frames in every mode, because
Shift is this app's one modifier for "grow the selection" and a hand arriving from the timeline is
already right.

Two details that are easy to get wrong and were:

- in `create`, the note's own press handler returns **before** `stopPropagation`, or a drag begun
  over an existing note would be swallowed by a note that has nothing to do in that mode;
- `remove` takes the note on the PRESS and arms nothing — no grip, no pointer capture, no drag to
  cancel. The ghost is painted the same way every other edit here is, so a refused command puts
  the note back.

`a` selects, `n` creates, `d` removes, and Escape returns to `select`. `a` is the neutral one on
all three surfaces and `d` takes something away on two: the pane in FRONT wins both, which is the
rule the clip pane's other verbs already follow.

### The body also drags in PITCH, and that is a different verb

A roll whose notes only slide sideways is a roll you cannot compose on. The body drag therefore
carries a `dKeys` beside its `dBeats`, snapped to the row and **never freed by a modifier** — a row IS a
semitone, and there is nothing between two of them for a key to reach. The two edge grips
stay horizontal: they are on the note's ENDS, and an end has no pitch.

Which verb commits is decided by whether the pitch changed:

- it did → **`sequence note move`**, which keeps the duration, the velocity and a pad's effects;
- it did not → `sequence note timerange`, as before.

Not one verb for both, though `move` could carry a purely horizontal drag: `moveNote` **refuses an
occupied destination** and `setNoteTimeRange` does not (`@studio/song-schema` `docs/noteEdits.md`),
so routing every move through it would start refusing drags that work today. A drag whose pitch
change the keyboard's edge swallowed counts as horizontal, which is what `movesPitch` answers.

### A body inside the rectangle drags the whole selection

Pressing the body of a note the live rectangle holds moves **every** note it holds by the same
beats and semitones — the same snapped offset, the same keys — and commits them as one
`sequence notes move`, so one Ctrl+Z. The edges and the velocity line keep their own gestures,
and a note outside the rectangle is dragged alone, as before. The OFFSET is clamped, not each
note: the group stops when its top or bottom note reaches the keyboard's end, or its earliest
reaches beat 0, so a chord dragged against an edge keeps its shape rather than folding onto one
key (`groupOffset` in `rollDrag.ts`). A drop where a note that stays already starts is refused
before anything is painted, the writer's own rule asked of the roll first (`planGroupMove`); a
note leaving makes room for another arriving. The rectangle follows the notes.

### Removing and splitting

Backspace (and `x`, on a grid) removes what the caret is on, or everything a rectangle holds,
through `selection delete` — one more line of the same family as `selection copy` and `selection
paste`. It goes to whichever surface holds a RECTANGLE, the clip grid first; with none drawn, to
the open grid's caret, and otherwise to the timeline's — but only the timeline in FRONT, since it
stays mounted off screen and a key must not take an event from a page you are not looking at. On
the timeline the line is one `events remove` naming each event the rectangle holds, by the rule
`copy` keeps (track rows, an event in when it STARTS inside), so copy and delete cannot disagree
and a cleared rectangle is one Ctrl+Z. The pane answers with a command **line** rather than
running one, which is what keeps a gesture worth exactly one Ctrl+Z; the shell runs it.

The roll and the step sequencer answer the same two lines: one note is `sequence note remove`,
several are one `sequence notes remove` over the rectangle. A sequencer row is a rack SOUND, in the
rack's order, so the key range from a rectangle's lowest row to its highest can cross rows outside
it. When that range would take a note on such a row, the delete is REFUSED (`planSelectionDelete`
in `stepGrid.ts`): splitting it into one line per row would cost a Ctrl+Z per row, and taking the
stray note would delete something the rectangle does not show as selected.

Right-click on a note offers the same removal and, when the caret sits strictly inside it,
`sequence note split`. Both were verbs with no gesture. The menu is derived from the catalogue
like every other (`contextMenu.md`); a split on either edge is not offered at all, since a cut
there leaves a note of no length.

### …and the roll's gestures land on those lines, unless a key says otherwise

Drawing a note, moving one and stretching one all snap to `gridUnit` — the step the ruler is
drawing and the caret is walking. A roll free at every zoom would be the odd one out: the ruler
draws lines, the caret walks them, the timeline's drags land on them, and only a note would ignore
them. A finer position is reached by opening the view, or by a key.

**Moving and stretching a note take the timeline's keys** (`snapMode`, `timeline.md`): nothing
held, the moved start or the stretched end lands ON the grid; **Ctrl** moves it by whole steps, so a
note played in by hand at 2.43 keeps that phase when you move it a beat; **Shift** frees it. The
rule and its arithmetic are `src/snap.ts`, so the two surfaces cannot come to mean different
things. The keys are read live, off each pointer event, so a note can be begun on the grid and
finished off it.

**Drawing keeps Ctrl as its free key** (`freeSnap`), because Shift on the lane is already the
selection rectangle, in every mode.

**Drawing snaps to CELLS, not to lines**, and that difference is the roll's own. The same press
places the caret, which belongs to the cell you pointed *inside* — a floor. A note landing on the
nearest *line* — a round — would sit one cell away from the caret half the time, and the two would
disagree about where you had just clicked. So `drawSpan` starts the note at the pressed cell's
beat and ends it at the FAR edge of the last one, the way `colSpan` reads the rectangle: drag
across three cells, get three cells of note. A press that never leaves its cell covers **that
cell** — one grid step — rather than leaving the length to the command's own default, which is a
whole beat: on a 1/16 grid a plain click would otherwise lay down sixteen cells of note, and the
draft box would have shown one. Ctrl frees the grid and there is then no cell to take, so a freed
click is worth `gridUnit` all the same.

`atEvent` therefore stays unsnapped, and the raw beat is what the gesture remembers. The grid is
applied where the span is READ, so Ctrl pressed or released mid-drag changes the whole answer
rather than half of it.

**In the step sequencer, Ctrl+drag means something else** — it MOVES a note to another cell (see
above). No contradiction: that grid has no free positions to reach, so there is nothing there for
Ctrl to suspend. Worth knowing before assuming one modifier means one thing across all three
views.

## The caret, and the rectangle it grows into

The timeline's caret is here too, on both grids: `hjkl`/arrows move it, `v` grows it into a
rectangle, Escape drops that, **Shift+drag** draws one with the pointer, anchored where the
pointer PRESSED rather than at the caret: a hand reaching for a region means that region, not
wherever the keyboard last left the caret. Same keys, same marks —
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
resolution control everywhere else here (`packages/ui-timeline/docs/ticks.md`), so a finer caret
is reached by opening the view, not by a second setting nobody would find. It is also why the
caret resets when the unit changes — column 12 is a different MOMENT once the step halves, and
that is not where you put it.

### The roll lights the row and the column under the pointer

Hovering the roll lays a faint band across the pitch the pointer is on and another down the
column, and lights that key in the gutter with its name (`src/hooks/useRollHover.ts`). On a grid
of 128 rows of a few pixels each, reading which key a note or a click lands on along the row is
what takes the time. The cell is a CELL as the caret's is, the column one step of the ruler's
unit, so the band says where a click lands, not where the pointer happens to be within it. It is
a mark and nothing else: it moves no caret, and it goes when the pointer leaves the grid.

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

`selection copy` (**Ctrl+C**, or `c`) puts the rectangle's contents aside; `selection paste`
(**Ctrl+V**, or `p`) puts them down with their **left edge on the caret**: the clipboard holds
coordinates relative to the rectangle's corner, so the copy's START lands where the caret is and every
note keeps its distance from it. On the ROLL a paste keeps each note's own **pitch** and takes only the
time from the caret: you click where the phrase should go, and a melody or a drum pattern pasted
elsewhere is the same phrase, not one transposed to whichever row the click fell on. The sequencer's
grid, whose rows are pads, still puts the top row under the caret. `src/clipboard.ts` is the arithmetic,
pure and tested.

**With no rectangle drawn, the caret is one.** A caret is already pointing at something, so it is
treated as the smallest rectangle there is: one cell in a grid — the note or step under it — and
on a lane, where the unit is a clip rather than a grid step, the **placement** under it, taken
over its own length. `cellBox` in `gridCaret.ts` is the grid half; `TimelineTab`'s `copy` is the
lane half, and both feed the same `clipboard.ts` path a drawn rectangle feeds.

That matters rather than being a nicety: answering a `v` rectangle and nothing else, with a key
*conditional on one being drawn*, means selecting an event by clicking it and pressing Ctrl+C does
nothing and **says** nothing, and the paste then reports an empty clipboard. Two rules follow, both
pinned in `keys.test.ts`:

- **The clipboard keys are unconditional**, alone among the bindings. A key that goes quiet is
  indistinguishable from one that is broken, and these two always have an answer.
- **The command says what it found.** Parked on a bare stretch of lane, `selection copy` reports
  *nothing to copy* and names both ways of pointing; the status line is where a command speaks.

The clipboard is **one slot for both kinds**: copying is a single gesture with a single memory,
and two clipboards would make "what does paste put down" a question about which pane you copied
from three minutes ago.

**The copy FALLS THROUGH; the other routed verbs do not.** `ui select`, `transport locate` and
`transport loop` stop at the pane in front — they *act* on it. `selection copy` asks it a
question, and the pane in front is routinely the one with no answer: clicking an event in the
timeline is what opens the clip pane, and the roll it opens starts with its caret at key 127,
where no note has ever been. Stopping there, the copy asks the roll, finds nothing, and never
asks about the event you just clicked — with the timeline's caret sitting on it — and the paste
reports an empty clipboard, which is true and useless. It is the clip pane **and then the
timeline**, first answer winning.

| copied from | what is held | which the paste runs |
|---|---|---|
| the timeline | placements, by lane offset and beat | `events add` |
| the roll | notes, by semitones below the top row | `sequence note add` |
| the sequencer | the same, through the rack's rows | `sequence note add` |

**The selection is the subject, and that is what the naming says.** The head names what all three
verbs act on — the region you drew — once. A bare `paste` would promise nothing, leaving the status
line as the only place to find out what had been pasted where; a pair of verbs naming the material
(`events paste`, `sequence notes paste`) would say it twice, since the same rectangle goes out
under one head and would come back under one of two others, across a namespace line.

The routing that a plural would buy is a **fact the clipboard already carries**: it was copied as
events or as notes, so notes land in the open roll or sequencer and events on the timeline's caret
whatever else is on screen (a clip pane holds notes and could not place a placement). Read off the
held rectangle by `selection paste` (`src/ui/commands/timeline.ts`), which is not a guess. The paste is one binding, and a
plain one: what the clipboard holds is read by the handler, so no key has to ask.

**Four tokens, two bindings.** Ctrl+C and Ctrl+V are the *only* modifier chords this shell takes
off the browser (`CHORDS` in `keys.ts` — ⌘ fires them too, and produces the same token). They are
where a hand already is, and a DAW that answered them with the browser's own text copy would be
the odd one out among every application a person has open. The plain letters stay beside them
because this timeline is driven by single keys — `v`, `z`, `m`, `s` — and a hand already there
should not have to reach for a modifier. Each pair names **one** binding constant, so the chord
and the letter cannot come to mean different things.

One stand-aside, in `App`'s listener rather than in the keymap: with text actually **selected on
the page** — a log line, a status message — Ctrl+C is the browser's copy and is let through. A
grid's rectangle is not a DOM selection (the timeline's lanes are `select-none`, the roll's drags
`preventDefault`), so the two cases cannot be confused.

`selection consolidate` is the third of the head, and the catalogue's own rather than the shell's
(`commands.yaml`). Same subject: it takes a rectangle — one lane, `from`, `to` — where every
`event …` verb takes one placement by its start. `selection delete` is the fourth, back on the
shell's side because the pane is what knows which notes or events the box holds.

### What else the rectangle can do

Four `sequence notes …` verbs — remove, transpose, quantize, velocity — take a rectangle rather
than one note, which is why they are plural. Their address is the box the roll already draws:
two keys inclusive and a half-open beat span, and a note is in when it STARTS inside, which is
`notesInRegion` in `clipboard.ts` — the rule stated once, so copying and deleting cannot disagree
about the same box.

Each is **one pass over the file** and therefore one journal entry.
Running the singular verb N times would be N of them, and half could land while the rest failed —
an undo would then be a fifth of the way back. `mapNotesInRegion` in `@studio/song-schema` is
where that pass lives; the four verbs are four three-line functions over it.

They are offered on the note's own right-click, when the click landed inside the rectangle. The
three that owe a value go to the bar with the box already spelt (`needsMore`), which is what the
mechanism is for and what spares the shell three more key bindings. What each of them decided —
quantize keeps the length, transpose clamps rather than drops, velocity is absolute and 1 clears
the field — is in `@studio/song-schema` `docs/noteEdits.md`, beside the writers.

### The roll paints first too

`sequence note` costs the same ~400 ms here as it does in the sequencer, and the roll holds
its own ghost while the reload is out: `src/rollPending.ts`, keyed by `${key}@${start}` — the
address every note verb takes — rather than by cell and precision, which is the sequencer's shape
and not this one's. `settledEdits` is deliberately not generalised over the two.

One thing it has that the sequencer's has not: a **move** is one ghost saying "gone from here,
there instead", so it settles only when both halves have landed. A document holding the note at
both addresses is a half-read reload, not a settled edit. And the same rule as the sequencer's
otherwise — nothing in flight and a document arrived means the document has the last word, so a
ghost that still disagrees was a command that FAILED and is dropped. That is why the four commit
callbacks answer the command's promise instead of dropping it.

### The click is HEARD

A note posted in silence is a note you cannot check. The press plays it — the note under the
pointer at what it is worth, or the pitch a draw gesture is starting on — and a pitch drag
re-plays on every row it crosses, which is what makes a transposition judgeable at all against a
128-lane grid.

It is `{ type: "note-preview", track, key, vel }`, straight down the engine's socket rather than
through the file service (`engine/k7-runtime/docs/protocol.md`). Two things follow from the choice:

- **It goes through the TRACK's own chain**, so what you hear is the instrument you are writing
  for — unlike `preview`, which loads a file into a hidden sampler and bypasses everything.
  A sequence FILE open in the editor has no placement and therefore no chain, so that roll stays
  silent: honest, rather than a wrong instrument.
- **There is no note-off on the wire.** The engine releases it after 100 ms, through Tracktion's
  own `playGuideNote`. A release that has to arrive is a hanging voice every time it does not —
  a dropped pointerup, a closed pane, a socket that blinked.

A row's NAME plays too: a key in the roll's gutter, a sound's name in the sequencer's. That click
is at **half velocity** (`AUDITION_VEL`, MIDI 64), whatever the notes on the row are worth. It is
a check of which sound a row is, and a full-velocity hit to identify a kick is louder than the
question. How quiet half velocity actually sounds is up to the instrument's velocity response.

DOUBLE-CLICKING a row's name selects the whole row, first step to last. The row's header is the
one place a row is named whole, and a pointer gesture there is the only way to take a row without
leaving the mouse for `v` and the keys. The header is live even on a surface that cannot audition,
since the double-click still has work to do.

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
- **An event is copied WHOLE** — its window, its fades, its passes, its `disabled` and its
  `warp: false`, not just its `ref` and where it sat. See below for why that took a wire change.

### Copying an event needs the placement's own words

An event's attributes cannot be read back off what a surface is given, for a structural reason: a
**compiled clip is a placement and its material already resolved together**, and that resolution is
one-way.

| what the file says | what the compiled clip has | can you get back? |
|---|---|---|
| the event's `from`/`to` | `sourceFrom`/`sourceTo` — the INTERSECTION with the material's own window | no |
| a *sequence's* `from`/`to` | `loopStart`/`loopEnd`, sharing the field with the loop range | no |
| `loop: 4` | folded into `length`, as `4 × window` | no |
| `fadeIn: "0:2"` | `fadeIn` in beats | only with the tempo |

So `ref` and `start` are the only two fields a copy could read off a compiled clip and write back,
and the timeline copies off the compiled document because that is all a surface is given: a
trimmed, faded, four-pass event would paste as one plain pass of the whole material, silently.

Guessing the rest from the resolved numbers is the tempting answer and is wrong twice: writing the
INTERSECTION as the pasted event's own window pins it to today's material — the copy stops
following the clip file — and a sequence's window is not separable from its loop range at all.

So one field, `ClipDoc.event`, carries the placement's own words **unmerged and as authored**,
mirrored onto `WebClip.event`. As authored matters: a window spelled `"2:1"`
comes back `"2:1"` rather than the seconds it means at the current tempo, because what reads it
writes it straight back into a file that must still mean the same thing after a tempo change.

Three consequences worth knowing:

- **Only what the file SAID.** No `loop: 1`, no `warp: true`. A default written out is a default
  the paste would then write into the new lane's file, restating what its absence already says —
  and this rides on a document polled every two seconds.
- **`start` is the only field a paste re-spells.** The window and the fades measure into the
  MATERIAL — seconds into a file, positions in a sequence's notes — while `start` is a position in
  the arrangement. Offsetting them too would play a different slice of the file the further along
  you pasted.
- **The engine ignores it**, like `warpOff` and `disabled` beside it: it is handed the merged
  answer as ever. Verified by rendering a document that carries one, not by TypeScript — the C++
  reads named keys, so an unknown one costs it nothing.

`events add` takes the whole placement vocabulary to receive it, and validates against
`PlacementSchema` rather than field by field: that schema is `.strict()`, so a key this verb has no
business writing is refused by name instead of landing in a lane's file.

**Neither is a `ui` command.** `ui` promises to touch nothing of the project, and by that rule the
copy would belong to it — the clipboard is the shell's and no file moves — while the paste WRITES
and could only be bare-named, which puts one gesture's two halves on either side of the namespace
line. The rule holds for everything else; here a better subject is available, and a head that
names the thing acted on beats one that classifies the side effect. `event move` and the file-tree
verbs are on the far side of it.

## A clip with a window is FRAMED on it, not caged to it

Neither editor draws the window and **nothing else**, for the same reason — a window can only be
judged against what lies outside it, and material a trim or a resize would give back is material
you have to be able to see. What they draw instead is one shape, twice:

| | the reach | the act |
|---|---|---|
| the **roll** (`src/rollFit.ts`) | the whole sequence, rounded up to a bar | the clip's window in beats (`clipLoop`) |
| the **audio clip panel** (`AudioClipPanel`, `src/barWindow.ts`) | the whole file | the EVENT's window in seconds |

Each opens **framed** on its act — the window plus a margin either side, a fifth of it on the roll
and a bar on the panel — and the wheel reaches the rest. The act is drawn as ground, a colourless
wash with its two edges picked out, and what is outside it is context: dimmed on the roll (a note
that sounds in no pass is 30% and takes no pointer), plain on the panel.

Editing stops at the edges, and is **refused rather than clamped** in both: a note drawn outside
the window would be a note you drew, saw, and never heard, and an onset appearing at the edge
instead of under the pointer is an edit nobody made.

Two things the roll does anyway. The grid is **absolute** — a window opening at bar 3 says 3, not
1 — and the playhead **folds** back into the window (`from + localBeat % win`, from the window's
start, since the notes are drawn at their beat in the file) instead of walking off
along the placed extent, because the later passes of a looped clip really are the same picture
again. The pitch fit reads only the notes the window contains, so a stray note three octaves down
cannot squash the pitches that are actually playing.

**`WaveformView` in `whole` mode** — the strip a `clips/*.k7x` opens in the editor — is the same
rule at its plainest. Its purpose is to show the file the window is judged against, and it is where
the `from`/`to` handles live.

## What the roll OPENS on, without a window

`src/rollFit.ts`, and both axes work the same way: frame what is **used**, with a 20% margin, and
let the canvas run to the placed extent — the later passes are there to be scrolled to. On the
pitch axis that is the used range ±20%, clamped to the 128 keys that exist; on the time axis it is
the span the notes occupy, not `[0, clip.length]`, which on 16 beats of notes placed 35 long would
open the pane 38% full where the margin asks for 83%. With a window the fit question disappears:
the view IS the window, and the pitch fit reads only the notes the window contains.

### The fit is taken once per clip, and an edit does not re-take it

The row height and the pixels per beat come from the fit's spans, and those spans depend on the
notes. Re-fitting on every edit would rescale the roll whenever a moved note left the framed range:
the view would slide under the pointer and the zoom would change mid-drag. So `PianoRoll` keeps the
fit's `rows` and `beats` for as long as the clip's identity holds. Only the canvas's reach
(`canvasBeats`) follows the notes, and that adds room without moving anything already drawn.

### A different clip opens at fit, zoom included

`useHZoom` holds its multiplier in state, so both panes reset it on the clip's identity. Without
that reset a clip opened after a zoomed one inherits the previous one's scale — the half of "it
does not open on its content" that no fit arithmetic can fix.

The roll's framing effect waits for that reset (`if (zoomX !== 1) return`): on the commit that
changes `clip.id`, `ppb` still carries the old multiplier, and scrolling by it lands somewhere else
entirely.

### "A different clip" is not the same question as "different MATERIAL"

The waveform's fetch depends on `clipEnvelopeKey`, not on `clip.id` — which is exactly the thing a
trim does not change: `event trim` rewrites a window and leaves the identity alone, so a fetch hung
on the id keeps drawing the material the pane had before. It is the same key the timeline's
envelope cache is filed under, so the pane and the blocks behind it cannot disagree about what a
clip currently plays. `docs/timeline.md` ("Activity runs through the blocks") holds the reasoning
and lists what is still stale until a reload.

A trim therefore re-fits the pane, like opening another clip does. That is the honest reading:
the region really is a different one.

## The loop marks

`src/clipLoop.ts` is the arithmetic, shared so the panes cannot disagree: the window that
repeats, how many passes fit the placed length, and where each later pass begins. The roll's
header states the loop and its pass count in words. The waveform strip (`WaveformView`,
outside `whole` mode) spans the placed length and draws the marks in violet
— the one hue nothing else there spends (yellow transients, blue warp marks, `primary` slice
windows) — as a tinted band with its two edges picked out and a fainter line per repeat.

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

## The loop switch, and its points in the ruler

Both clip panels — the roll and the audio clip panel — carry a **loop** switch in their header, for
the EVENT they show: on, the event repeats its window; off, it plays it once. It is `event loop`,
dispatched rather than doubled, and a panel showing no placement (a sequence file, a piece of a
comp) draws no switch. On, the switch's colour is the loop marks' violet.

While it is on, **the loop's two points are a brace in the ruler**, and they drag. The points are
the event's window — there is no loop range apart from it (`packages/song-edit/docs/eventLoop.md`)
— so the brace sits on the ruler drawn in the window's own unit:

| panel | ruler | unit | snaps |
|---|---|---|---|
| roll | the file's bars and beats, under the song's | the notes' beats | to the ruler's step; Alt drags free |
| audio clip panel | the song's ruler over the wave | seconds of the file | nowhere, like the window's own edges on the wave |

**The drag is local until release, then one command** (`event loop points`), so the file is
written once per gesture and the reload lands once. A looped event keeps its length on the lane
while its points move — the passes give — which is why the wave's own edge drag sends the same
verb while the event loops, rather than `event window`, which keeps the passes and moves the length.

The audio clip panel's header carries the event's **gain** beside the switch: a slider from −6 to
+6 dB (`src/components/EventGainSlider.tsx`), committed once on release as `event gain`, and put
back to unity by a double-click. The roll has none: a MIDI event has no level of its own
(`packages/song-edit/docs/eventGain.md`).

`src/components/LoopBrace.tsx` is both halves, unit-free: each panel hands it its own mapping to
pixels, and the bounds the event cannot leave (the material's).

## The material's window — a different thing from the loop

`from`/`to` say which span of the source the clip IS. The loop says how many times that span is
played. They coincide for MIDI and are stated in one pair, which is why `clipLoop` reads
`loopStart`/`loopEnd` for both — but the drawing question is not the same one, and the surfaces
answer it two ways:

| | how the window shows |
|---|---|
| `WaveformView` (a clip file in the editor, `whole`) | shaded over the whole file, from the TEXT, live as you type — the view the window is JUDGED in, and the one it is SET in: both edges drag |
| `AudioClipPanel` (clicking an audio event) | the pane roams the FILE and the event's window is a band on it — see below |
| the roll, placed sequence or `sequences/*.k7x` | the canvas spans the sequence and the pair is a band on it — the panel's shape, in beats |
| the tracker and the inline grids | the band, drawn as ground under the notes |

Where it is still a band it is deliberately colourless — a white wash with its two edges picked
out. These panes already spend violet on a selection, blue on a warp, teal on a marker, emerald on
a note; a seventh hue for the thing all of those sit *inside* would compete with every one of them.

### The waveform's three views ARE its three gestures

`standard`, `onsets`, `warp` — named in `waveMode.ts`, and they were always modes: each one decides
what is DRAWN over the wave *and* what pointing at it does. That pairing is deliberate and is why,
unlike the timeline, there is **no separate tool axis here**. On a lane a tool and a mode are worth
keeping apart, because the pointer's meaning is not drawn anywhere. On the wave it is: the marks
you can touch are the marks you can see, so a second axis could only let the picture and the
pointer disagree about what a click would do.

| view | what a press does |
|---|---|
| `standard` | nothing on the wave itself — the window's two edges still drag, which is what sets an event's window |
| `onsets` | a click adds a transient, a click on a pin removes it, dragging one moves it — `clip onset add` / `remove` / `move` |
| `warp` | a double-click pins a stretch point, dragging it says where its beat lands, a right-click removes it — `clip warp` / `clip warp remove` |

The modality has **a way in that is not the mouse**, by the shell's own rule that no control on
screen is unreachable from the command bar (`shell.md`): it is `ui wave <mode>`, the select DISPATCHES
that command instead of setting the state beside it, and `o` and `w` reach the two mark views while
`a` — or Escape — comes back to `standard`.

`a` is shared with the timeline's arrow, and the waveform wins it: the clip pane is the surface in
front, which is the rule its other verbs already follow (`clipGrid ?? timeline` in `App`). Escape's
rung is conditional on `wave_marks` rather than on a waveform being open at all — in `standard`
there is no mark to back out of, so the ladder should fall through to the pane behind.

The panel says what a press would do on every change of view, and the footer's badge carries the
name while it is anything but `standard`. Same reason as the timeline's: the status line is a
message and passes, a mode does not.

A **32px column of icons** sits down the panel's left edge, one per view, the current one lit —
the same strip the timeline carries, from the same table (`modeIcons.tsx`), and the only way to a
view that a finger has. It is drawn only once there is a file: while a take rolls there is no mark
to point at, so there would be nothing to choose between. Like the select above it, each button
dispatches the command.

**The cursor over the wave is the button's own drawing**, built from the same SVG body — see
`timeline.md` for why that matters and how the outline and hotspots work. `standard` keeps the
system's arrow, having no mark to place and so nothing to promise.

### The clip panel frames the EVENT, and acts only on it

Double-clicking an audio event opens `AudioClipPanel` on the whole file, framed on the window **that
event** plays: its span plus a bar of context either side (`frameWindow`). The wheel still reaches
everything, and the header offers both ways out — *tout* for the file, *l'événement* to come back.

Two spans, and keeping them apart is the whole design:

| | what it is | what it decides |
|---|---|---|
| `reach` | the whole file | how far the wheel may go |
| `act` | the window this event plays | what is framed, banded, and acted on |

`act` is **not re-derived here**. The compiler already intersects the clip's own `from`/`to` with
the placement's — `Math.max` of the froms, `Math.min` of the tos, in `nodeProject.ts` — so a
`WebClip`'s `sourceFrom`/`sourceTo` IS the event's effective window, and `ClipView` passes it down.
A second copy of that arithmetic in the browser is exactly how the two would come to disagree.

The panel asks for `whole`, and in that mode `WaveformOps` reads `clips/<id>.k7x` rather than the
compiled placement, which knows nothing about which event you clicked — so `act` cannot come from
the picture the pane is drawing. Taken from there, a phrase placed with `from: 3.51` would show
the whole take with no way to tell which part of it is the one on the lane.

What acting "only on it" means, verb by verb:

- **the trim gate** previews inside `act`, and the command it runs — `event trim <track> <at>
  [gate]` — reads the very same window off the placement, so the preview and the act cannot
  disagree by construction rather than by being handed matching numbers. It only ever NARROWS:
  material an earlier trim removed comes back through undo, deliberately;
- **the middle button pans**, as it does on every scrolling pane through `usePanScroll`. Written
  out here because this pane does not scroll — it draws a view span, so the drag moves the window
  rather than a `scrollLeft` — with the same direction (the view follows the hand) and the same two
  precautions: the capture phase, so a child stopping propagation cannot swallow it, and a
  `mousedown` preventDefault for Firefox's autoscroll puck;
- **onsets** are pins inside `act` and plain rules outside it — visible, not touchable — and a
  click past the edge adds nothing. Refused rather than clamped: an onset appearing a hair from
  where the hand let go is an edit nobody made;
- **the ruler** offsets from `act.from`, since `placedAt` is the beat that window starts playing
  at. The file's head is not placed anywhere at all.

**What a trim WRITES is this EVENT's window**, so there is no caveat to carry about the other
placements of the same clip: a clip file describes the bytes and a placement describes the use
(`packages/song/docs/materialCut.md`), and trimming one event leaves the others alone by
construction. The verb says it — `event trim` names the placement it acts on, like every other
`event …`.

### `whole` draws the file, and reports the window separately

`regionWaveform` opens its region at `sourceFrom` and blanks whatever lies past `sourceTo` — right
for a placement, and wrong for the one view whose whole purpose is to show the file the window is
judged against. Cropped there, the pane draws the trim itself: the head gone, the tail flat, and no
way left to see what was cut or to judge putting it back. So `WaveformOps` draws the whole view
windowless and reports the window separately, which is also what keeps `WaveformView`'s own overlay
honest — it measures `from / wf.seconds`, and over a cropped picture that shades the wrong span of
an already wrong picture.

### …and a timecode edge resolves the way the compiler resolves it

`loadAudioClipDoc` takes the project's grid, so `mapClip` — the path it takes, and therefore the one
the `whole` view reads — resolves an edge written as a timecode as well as one written as a number,
exactly as `nodeProject` does. Read numerically, `Number("2:1")` is `NaN` and the field is skipped,
which produces a clip with **no window**: one field's two spellings draw two different pictures, and
a song whose clips are written `to: "3:1"` has no band to shade at all.

Without a grid it drops a timecode rather than guessing, so the preview callers that pass none are
unaffected — they read only `source` anyway.

The window rides on the payload in the same display seconds as the onsets and the warp marks, mapped
through `RegionWaveform.toDisplay` — the region's own projection, handed out rather than copied. A
second `(sec - inPoint) * stretch` elsewhere is exactly how a band comes to sit a pixel off the marks
beside it.

## The strip's ▶ plays the WINDOW, not the file

`WaveformView`'s header carries a play button, and what it plays is what the strip is showing: for
a clip file open in the editor, the span `from`/`to` declare, at the material's own rate.

It sends the `PreviewReq` the strip CARRIES rather than one built from what is on screen, because
the three strips are three different requests — a clip file names its clip, a slice rack's dock
names the shared source, a gutter preview is whatever was auditioned there, slice window included.
Deriving one from `clip.id` would work for exactly one of them: a source preview's id is a *path*.

**The window is resolved server-side**, in `Workspace.resolvePreview`, and that is where the
substance is: it reads the compiled `sourceFrom`/`sourceTo`, with the project's grid passed in so a
**timecode** edge resolves the way it does everywhere else. Answering `{start: 0, length: 0}` for a
clip is the whole file end to end, so a take trimmed down to one bar of a five-minute pass plays
the five minutes and the ▶ says nothing about the clip you are looking at. An absent `to` does stay
a length of 0, which the engine reads as "to the end of the file", capped at 30 s — the only honest
answer about an extent nobody here has opened the wav to measure.

One shot, and no Stop button. The engine fires a voice through a preview sampler independent of the
transport (`EngineHost::previewSample`); there is no state to poll and nothing to stop, so a toggle
would be drawing a state this side cannot know. It also means the ▶ is **not** the transport: it
ignores the placement, the track's chain and the master — you are hearing the material, not the mix.
Warping is not applied either, for the same reason: a stretch map maps the source onto the SONG's
grid, and there is no song in a one-shot.

### The audition has its own playhead, and a clock drives it

An amber line, over the span that is sounding — a different mark from the transport's near-white
one, because "where the song is" and "where the audition is" are two claims about one picture and
they can be on screen together.

**Driven by the clock, not by the engine**, and that is the honest description rather than an
apology. A sampler voice does not ride the state frame; nothing about it reaches this side. What IS
known exactly is the window — the service answers it in the `/preview` reply rather than leaving the
browser to resolve `from`/`to` a second time, since a second resolution is precisely how a mark
comes to sit where the sound is not — and a sample plays at its own rate, so elapsed time since the
trigger *is* the position. One error term, the engine's: the first play of a file loads it
asynchronously and fires a turn later, so that first mark can run slightly ahead. Every play after
it is immediate.

`AuditionPlayhead` is a LEAF for the same reason `ClipWaveform` is one: it moves sixty times a
second, and the slice handles, warp marks and loop lines have no business re-rendering with it. It
stops itself at the end of the span instead of telling the parent, which keeps even that one render
away — a new ▶ makes a new span, and a new span restarts it.

## Dragging the window's edges

The window this pane drags is the EVENT's, so the gesture is on the event: `AudioClipPanel`'s band
has two handles, and releasing one runs `event window <track> <at> <from> <to>` — journalled like
every other edit here, and undone with one Ctrl+Z.

The handles live **inside `@studio/ui-waveform`'s canvas**, not on a layer the host puts over it.
`timeToX` is the one authoritative mapping — it already carries the view's zoom and the measured
width — and a second `(sec - v0) / span` computed outside is exactly how a handle comes to sit a
pixel off the line it is holding. The marker pins beside them are placed the same way. Twelve
pixels straddling a 1.5px line, because the line itself is not a thing a hand can catch.

Three rules are worth stating because the gesture does not show them:

- **Seconds, always.** The pair addresses a file, and a hand pointing at a waveform points at a
  second of it. The field takes both spellings, so a window written musically by hand survives
  untouched — until somebody drags it, and then it is seconds.
- **The two absences are kept.** A `from` pulled back to the material's start is DELETED rather
  than written as 0, since absent already means the start; a `to` pushed onto the file's end is
  left out for the same reason. Both edges go out on every commit, or an old one would keep
  narrowing what the drag just opened.
- **An event that plays its whole file still has handles.** It states no window, so no band is lit
  — a wash over the whole picture would tint everything and mark nothing — but its edges are the
  file's and they are still grabbable. That is the case with the *most* reason to reach for them:
  pulling one in is how a window comes into being. The band appears on the first drag.

Those handles are **clamped into the strip**, unlike the pins, and the difference is what each is
for. A pin is read, so one hanging outside the canvas would lie about where its mark is. A handle
is grabbed, and one that has left the canvas is a control that has vanished — which is precisely
what a whole-file event's edges do at any zoom past fit. The title carries the true second.

## Velocity, on the note itself

A horizontal line inside each note: at its bottom edge for 0, at its top for full. It is **half the
note's width and centred**, so it reads as a mark ON the note rather than as one of its edges — a
full-width rule at the top of a note is indistinguishable from the note's own border.

The note is also **split** at that line: solid below it, 80% above. So a row of notes reads as
levels at a glance, before the lines themselves are looked for, and a note too short to hold a line
at all still says what it is worth. The fill colour lives on the two halves rather than on the box,
which is what makes "80%" mean the note's own colour and not a wash of whatever is behind it.

Dragging **the line** up or down moves it and, on release, runs `sequence note velocity` — the same
shape as the timeline's clip drag, where the gesture is the view's and the commit is a command.

Four things worth knowing:

- **The units are the file's, 0..1** (`NoteSchema`'s `v`), not 0..127. The geometry is the MIDI one
  — low at the bottom — but nothing here invents a second scale for a value the file states.
- **Absent means 1.** `toWebTracks` sends `vel` only when the file said one *and* it is not 1, and
  the command CLEARS the field at 1 rather than writing the schema's own default back into a file
  that never mentioned it. So a sequence nobody has touched stays byte-identical, and a roll can
  tell "full" from "unstated" — which is the same distinction, drawn the same way.
- **The LINE is the handle**, inside a grab zone five pixels either side of it — a one-pixel target
  is not one, and the same reasoning sizes the waveform's 12px slice grips. Every grip on a note is
  a PLACE: the line sets, **either edge** stretches, the body moves. Taking the whole box for
  velocity and letting the DIRECTION of the first movement choose between it and a move puts two
  gestures on one surface, so neither can be started deliberately — a move beginning with a little
  vertical drift sets a velocity instead, and the only way to find out is to look at what changed. A
  note with nothing to move it (`onSetNoteRange` absent) does keep its whole box as the velocity
  handle: there is no second gesture to tell it apart from.

  The consequence, either way, is that a press on a note does not bubble to the lane's draw-a-note
  gesture — no loss, since two notes cannot share a key and a start, and it is what lets the two
  live on one surface now that `onCreateNote` is passed and the drawing is reachable.
- **A press that never moves commits nothing.** A stray click on a note must not silently rewrite
  what it is worth.

The live value lives in a **ref**, with state only for what to draw: firing the command from inside
a `setState` updater would run it twice under StrictMode's double invocation — a velocity written,
then written again.

## The takes mode, in both panels

`takes` is the fourth mode of the waveform and of the roll (`TakesView.tsx`): the open EVENT's takes
stacked, its own material first, on one song-time axis — the format and the recording path are
`packages/song/docs/takes.md`. It is a mode and not a third panel because it is a view of the same
event the panel is open on, and a mode is how both panels already switch what a press means.

- **The event, not the clicked clip.** A comped event is several clips on the timeline; whichever
  piece is opened, the view finds the event by the id every piece carries (`eventIdOf`), so a re-comp
  that replaces the piece that was clicked does not lose the view.
- **One gesture picks.** A drag selects a span, snapped to a sixteenth; a click on a row then runs
  `event comp` for that row over the span. A click with no span seeks, as the ruler above does. A
  row's ✓ is the same pick, or the whole take when
  there is no span: replacing the whole event is that, nothing else. In the piano roll's takes there is
  no span at all: a click on a row picks that take whole (song docs/takes.md says why).
- **Its own record button.** It arms the event and, where they were not, the lane and record mode,
  then rolls FROM THE START of the span, or of the event when there is none, with the count-in in
  the bars before it; the stop switches back exactly what it switched (`useTakeRecording.ts`). A span
  is the punch. The shell's record panel stays away for that take: the view is where it is drawn.
- **Offered only where there is an event.** A reviewed take and a bare sequence file have none, so
  their strips list the other modes (`WAVE_SOLO_MODES`, `ROLL_SOLO_MODES`).
- **The panel's own view stays mounted, hidden**, so its zoom, caret and scroll survive a switch.
- **Its crossfade tool** is the timeline's, at the comp's seams: a press takes the nearest seam, a
  drag sizes it, Alt removes it (`event comp fade`). Crossfades are drawn across every row.
- **A comped event's WAVE is edited a piece at a time.** Over the wave, a strip shows the comp: each
  piece in its take's colour (the takes view's, `takeColor`), each a button. The piece clicked is the
  wave below — its take's file, its slice of it framed — so onsets and warp edit that take's material.
  Its window edges are the comp's: growing a piece gives its take the span, shrinking it hands what it
  lets go back to the piece it touches (`pieceEdgeLines`). Trim, which writes the EVENT's window, is
  off on a piece (`CompStrip.tsx`).
- **The roll opens a comped event on its takes**: its notes view would show the first piece alone.

## What is deliberately NOT drawn

Nothing is hidden: every pane here shows more than the window and marks it instead. *What does not
play is not on screen* is the strongest statement available and the wrong one, because hiding what
does not play also hides what a trim would give back.

The outside is treated two ways, and the difference is real. On the **roll**, a note outside the
window is dimmed and inert: a sequence's window is its pattern, so a note before or after it sounds
in no pass at all, and saying so is honest. In the **tracker, the inline grids and `WaveformView`'s
whole view**, the outside is not dimmed — the band lights what plays rather than greying what does
not, because for a repeated AUDIO clip the pane past the window is not silence, it is the next
pass, and a rule reading "this does not play" would be wrong in the commoner case.
