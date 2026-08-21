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
[timeline.md](timeline.md) says how a mouse wheel is told from a trackpad slide — one zooms, the
other pans) and nothing else about their drawing: one draws 128 key rows, the other a canvas
envelope.

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

**The roll's zoom has no ceiling you can reach**, for the same reason the timeline's has none —
one `useHZoom`, one derived limit, and tick layers that build only the lines on screen. The roll
passes its own scroller to both. See `timeline.md`.

### Both edges of a note stretch it, as both edges of an event do

`sequence note timerange` always took a new start AND a new end, so this was a gesture the command
had been waiting for: the left edge moves the start and leaves the end, the right edge moves the
end and leaves the start, the body moves both. One verb, three grips — the same arrangement the
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
two copies of that arithmetic is a preview that lands somewhere else than the write.

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

`selection copy` (**Ctrl+C**, or `c`) puts the rectangle's contents aside; `selection paste`
(**Ctrl+V**, or `p`) puts them down with their **top-left corner under the caret**. That is the whole model — the clipboard holds
coordinates relative to the corner, so where you put the caret decides both the shift in time and,
on a roll, the transposition. `src/clipboard.ts` is the arithmetic, pure and tested.

**With no rectangle drawn, the caret is one.** A caret is already pointing at something, so it is
treated as the smallest rectangle there is: one cell in a grid — the note or step under it — and
on a lane, where the unit is a clip rather than a grid step, the **placement** under it, taken
over its own length. `cellBox` in `gridCaret.ts` is the grid half; `TimelineTab`'s `copy` is the
lane half, and both feed the same `clipboard.ts` path a drawn rectangle feeds.

That is a fix rather than a nicety. Copy answered a `v` rectangle and nothing else, and its key
was *conditional on one being drawn* — so selecting an event by clicking it and pressing Ctrl+C
did nothing and **said** nothing, and the paste then reported an empty clipboard. Two rules came
out of it, and both are pinned in `keys.test.ts`:

- **The clipboard keys are unconditional**, alone among the bindings. A key that goes quiet is
  indistinguishable from one that is broken, and these two now always have an answer.
- **The command says what it found.** Parked on a bare stretch of lane, `selection copy` reports
  *nothing to copy* and names both ways of pointing; the status line is where a command speaks.

The clipboard is **one slot for both kinds**: copying is a single gesture with a single memory,
and two clipboards would make "what does paste put down" a question about which pane you copied
from three minutes ago.

**The copy FALLS THROUGH; the other routed verbs do not.** `ui select`, `transport locate` and
`transport loop` stop at the pane in front — they *act* on it. `selection copy` asks it a
question, and the pane in front is routinely the one with no answer: clicking an event in the
timeline is what opens the clip pane, and the roll it opens starts with its caret at key 127,
where no note has ever been. So the copy asked the roll, found nothing, and never asked about the
event you had just clicked — with the timeline's caret sitting on it. The paste then reported an
empty clipboard, which was true and useless. It is the clip pane **and then the timeline** now,
first answer winning.

| copied from | what is held | which the paste runs |
|---|---|---|
| the timeline | placements, by lane offset and beat | `events add` |
| the roll | notes, by semitones below the top row | `sequence note add` |
| the sequencer | the same, through the rack's rows | `sequence note add` |

**The selection is the subject, and that is what settled the naming.** A bare `paste` came first
and was wrong in the way that family of commands is always wrong: the first word promised nothing,
and the status line was the only place you could find out what had been pasted where. It was
replaced by two verbs, `events paste` and `sequence notes paste`, each naming the material it put
down so as to name the surface that answered. That worked and said it twice — the same rectangle
went out under `ui copy` and came back under one of two other heads, three names for one gesture,
two of them across a namespace line.

`selection` says it once. The head names what all three verbs act on — the region you drew — and
the routing that the plural was buying is a **fact the clipboard already carries**: it was copied
as events or as notes, so notes land in the open roll or sequencer and events on the timeline's
caret whatever else is on screen (a clip pane holds notes and could not place a placement). Read
off the held rectangle in `App`'s `runLocalCommand`, which is not the guess a bare `paste` made.
The paste is one binding again, and a plain one: what the clipboard holds is read by the handler,
so no key has to ask.

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
`event …` verb takes one placement by its start.

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

**Neither is a `ui` command any more.** `ui` promises to touch nothing of the project, and by that
rule the copy belonged to it — the clipboard is the shell's and no file moves — while the paste
WRITES and was bare-named, which is what put one gesture's two halves on either side of the
namespace line. The rule still holds for everything else; here a better subject was available, and
a head that names the thing acted on beats one that classifies the side effect. `event move` and
the file-tree verbs are still on the far side of it.

## A clip with a window is FRAMED on it — it used to be caged

Both editors used to show the window and **nothing else**: outside it was not drawn, not
scrollable-to, not clickable. Neither does now, and they gave it up for the same reason — a window
can only be judged against what lies outside it, and material a trim or a resize would give back is
material you have to be able to see. What replaced the cage is one shape, drawn twice:

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

Two things the roll keeps from the cage. The grid stays **absolute** — a window opening at bar 3
says 3, not 1 — and the playhead still **folds** back into the window (`localBeat % win`) instead
of walking off along the placed extent, because the later passes of a looped clip really are the
same picture again. The pitch fit also still reads only the notes the window contains, so a stray
note three octaves down cannot squash the pitches that are actually playing.

**`WaveformView` in `whole` mode** — the strip a `clips/*.yaml` opens in the editor — was the one
pane that never caged, and it is now the rule rather than the exception. Its purpose is to show the
file the window is judged against, and it is where the `from`/`to` handles live.

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
| `WaveformView` (a clip file in the editor, `whole`) | shaded over the whole file, from the TEXT, live as you type — the view the window is JUDGED in, and the one it is SET in: both edges drag |
| `AudioClipPanel` (clicking an audio event) | the pane roams the FILE and the event's window is a band on it — see below |
| the roll, placed sequence or `sequences/*.yaml` | the canvas spans the sequence and the pair is a band on it — the panel's shape, in beats |
| the tracker and the inline grids | the band, drawn as ground under the notes |

Where it is still a band it is deliberately colourless — a white wash with its two edges picked
out. These panes already spend violet on a selection, blue on a warp, teal on a marker, emerald on
a note; a seventh hue for the thing all of those sit *inside* would compete with every one of them.

### The clip panel frames the EVENT, and acts only on it

Clicking an audio event opens `AudioClipPanel` on the whole file, framed on the window **that
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

It used to be **caged** to the clip's window instead, and to the *definition's*: the panel asks for
`whole`, and in that mode `WaveformOps` reads `clips/<id>.yaml` rather than the compiled placement,
which knows nothing about which event you clicked. So a phrase placed with `from: 3.51` drew the
whole take, and there was no way to tell which part of it was the one on the lane.

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

**What a trim WRITES is this EVENT's window.** It wrote the clip's, which every placement of that
clip shared, and the panel said so in amber beside the button whenever the event was a slice. Both
the caveat and the amber are gone with the thing they warned about: a clip file describes the bytes
and a placement describes the use (`packages/song/docs/materialCut.md`), so trimming one event
leaves the others alone by construction. The verb moved with the meaning — `clip trim` is
`event trim`, and it names the placement it acts on like every other `event …`.

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
Measured on 01.danse.st0, four of five sampled clips are written `to: "3:1"` and came back empty;
only the one trimmed by `clip trim`, which writes seconds, had anything to draw.

`loadAudioClipDoc` now takes the project's grid and resolves the edge the way the compiler does.
Without a grid it still drops a timecode rather than guessing, which is exactly what it did before,
so the preview callers that pass none are unchanged — they read only `source` anyway.

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
substance was. It used to answer `{start: 0, length: 0}` for a clip — the whole file, end to end —
so a take trimmed down to one bar of a five-minute pass played the five minutes, and the ▶ said
nothing about the clip you were looking at. It now reads the compiled `sourceFrom`/`sourceTo`, with
the project's grid passed in so a **timecode** edge resolves the way it does everywhere else. An
absent `to` stays a length of 0, which the engine reads as "to the end of the file" — the only
honest answer about an extent nobody here has opened the wav to measure.

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

The window is the EVENT's, so the gesture is on the event: `AudioClipPanel`'s band has two handles,
and releasing one runs `event window <track> <at> <from> <to>` — journalled like every other edit
here, and undone with one Ctrl+Z. A clip file states no window at all any more (the descent, see
`packages/song/docs/materialCut.md`), so there is nothing to drag on the editor's own strip.

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
  a PLACE now: the line sets, **either edge** stretches, the body moves. It used to be the note's
  whole box, with the DIRECTION of the first movement choosing between velocity and a move, and two
  gestures sharing one surface meant neither could be started deliberately — a move that began with
  a little vertical drift set a velocity instead, and the only way to find out was to look at what
  had changed. A note with nothing to move it (`onSetNoteRange` absent) keeps its whole box as the
  velocity handle: there is no second gesture to tell it apart from.

  The consequence, either way, is that a press on a note does not bubble to the lane's draw-a-note
  gesture — no loss, since two notes cannot share a key and a start, but it is the thing to remember
  if that gesture is ever wired up (App does not pass `onCreateNote` today, so the roll's drawing is
  unreachable from the shell).
- **A press that never moves commits nothing.** A stray click on a note must not silently rewrite
  what it is worth.

The live value lives in a **ref**, with state only for what to draw: firing the command from inside
a `setState` updater would run it twice under StrictMode's double invocation — a velocity written,
then written again.

Velocity had to be added to the wire to draw it at all: `WebNote` carried `time`, `duration` and
`key`, and the compiler's `vel` stopped at `toWebTracks`.

## What is deliberately NOT drawn

Nothing is hidden any more: every pane here shows more than the window and marks it instead. The
roll and the audio clip panel used to hide it — *what does not play is not on screen* — which was
the strongest possible statement and the wrong one, because it also hid what a trim would give
back.

The outside is treated two ways, and the difference is real. On the **roll**, a note outside the
window is dimmed and inert: a sequence's window is its pattern, so a note before or after it sounds
in no pass at all, and saying so is honest. In the **tracker, the inline grids and `WaveformView`'s
whole view**, the outside is not dimmed — the band lights what plays rather than greying what does
not, because for a repeated AUDIO clip the pane past the window is not silence, it is the next
pass, and a rule reading "this does not play" would be wrong in the commoner case.
