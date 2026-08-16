# The clip editors — the piano roll, the waveform, and the step sequencer

Panes over one event: `PianoRoll` for a sequence, `WaveformView` for audio, and — when the
sequence's track feeds a RACK — `SequencerPanel`, a step sequencer. `ClipView` picks between
them and all are mounted by the same two hosts — the editor's bottom strip, and the graph slot
when a clip is clicked in the timeline (see [shell.md](shell.md)).

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
must show, and stay editable, rather than read as data lost. The 🎹 button still opens the same
clip in the roll (off-grid timing and precise lengths live there); reopening the clip returns to
the sequencer, since the rack is what the track IS.

One plumbing fact this panel surfaced: the graph slot's `target` is a snapshot taken at the
click, so `ClipView` re-reads the compiled project on every `reloadKey` and re-finds the
placement by (id, start) — without that, a cell wrote its note and lit nothing, and the roll's
drags snapped back on release.

They share their pan/zoom hook (`@studio/ui-timeline/panZoom`, and
[timeline.md](timeline.md) says why a plain wheel scrolls) and nothing else about their drawing:
one draws 128 key rows, the other a canvas envelope.

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
