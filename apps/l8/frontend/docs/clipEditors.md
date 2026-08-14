# The clip editors — the piano roll and the waveform

Two panes over one event: `PianoRoll` for a sequence, `WaveformView` for audio. `ClipView` picks
between them and both are mounted by the same two hosts — the editor's bottom strip, and the graph
slot when a clip is clicked in the timeline (see [shell.md](shell.md)).

They share their pan/zoom hook (`@studio/ui-timeline/panZoom`, and
[timeline.md](timeline.md) says why a plain wheel scrolls) and nothing else about their drawing:
one draws 128 key rows, the other a canvas envelope.

## Both panes span the clip's PLACED length

Not its material. A clip looped three times is three times as wide as the pattern in it, and the
consequences are different in each pane:

- the **roll** draws the sequence's notes once, at their own times, and the rest of the canvas is
  empty grid — a real clip in LEMO - DANSE is eight beats of drums in eighty beats of pane;
- the **waveform** draws silence past the first pass, because `regionWaveform` clamps its buckets
  to the frames the source window actually has (`packages/commands/src/waveform.ts`). A 3× loop is
  one third of a picture and two thirds flat.

Neither is a bug and both look like one, which is what the loop marks are for.

## What the roll OPENS on

`src/rollFit.ts`, and both axes work the same way: frame what is **used**, with a 20% margin, and
let the canvas run past it. The pitch axis had always done that — the used range ±20%, clamped to
the 128 keys that exist. The time axis had stopped.

It framed `[0, clip.length]`, which is the **placed** extent, and for a looped clip that is the
window times the count. Measured on LEMO - DANSE, as a fraction of the pane's width the notes
occupied:

| clip | before | after |
|---|---|---|
| `da.dub/drums_2_0` — 7.1 beats of notes, 80 placed, 8-beat loop | 7% | 74% |
| `da.dub/drums_2_1` — 4 beats, 32 placed | 10% | 83% |
| `bs.chorus/bass_0` — 15.6 beats, 32 placed | 41% | 81% |
| `bs.verse/bass_2_3` — 16 beats, 35 placed, NO loop | 38% | 83% |
| `bs.verse/bass_2_1` — 16 beats, 16 placed | 83% | 83% |

The last two are the ones to keep in mind. A clip does not need a loop to be longer than its
material — `bass_2_3` is simply placed longer than its notes — so this was never only about
looping; and an ordinary clip already sat at the 1/1.2 the margin implies, which is why it went
unnoticed.

Three rules fall out of it:

- **the loop's window joins the content span**, so a pattern whose last hit falls short of the
  window's end still shows where the loop closes;
- **notes BEFORE the window stay in view.** They are in the file and they do not play, which is
  exactly the thing worth seeing — framing the window alone would hide them, and their absence
  reads as data lost;
- **the canvas still reaches the placed extent**, because the later passes and their marks are
  there to be scrolled to.

### A different clip opens at fit, zoom included

`useHZoom` holds its multiplier in state and nothing let go of it, so a clip opened after a zoomed
one inherited the previous one's scale — the other half of "it does not open on its content", and
the half no fit arithmetic could fix. Both panes now reset it on the clip's identity.

The roll's framing effect waits for that reset (`if (zoomX !== 1) return`): on the commit that
changes `clip.id`, `ppb` still carries the old multiplier, and scrolling by it lands somewhere else
entirely.

## The loop marks

`src/clipLoop.ts` is the arithmetic, shared so the two panes cannot disagree: the window that
repeats, how many passes fit the placed length, and where each later pass begins. Each pane draws
it in violet — a hue neither had spent (the roll: emerald notes, a white playhead; the waveform:
yellow transients, blue warp marks, `primary` slice windows) — as a tinted band with its two edges
picked out, a fainter line per repeat, a bracket on the roll's ruler, and the count in the header.

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
`loopStart`/`loopEnd` for both — but the drawing question is not the same one, and three surfaces
had three different answers to it:

| | before | now |
|---|---|---|
| `WaveformView` (a clip file in the editor) | shaded, from the TEXT, live as you type | unchanged — and correct at last, see below |
| `AudioClipPanel` (clicking an audio event) | nothing | the band, from `WebWaveform.sourceWindow` |
| the roll, on a placed sequence | only when `from > 0` or it looped | also when `to` cuts or pads |
| the roll, on `sequences/*.yaml` | nothing — dropped at the parse | the band, read from the text |
| the tracker and the inline grids | nothing | the band |

It is drawn as **ground**, under the envelope and under the notes, and deliberately colourless — a
white wash with its two edges picked out. These panes already spend violet on a selection, blue on a
warp, teal on a marker, emerald on a note; a seventh hue for the thing all of those sit *inside*
would compete with every one of them.

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

The area **outside** the window is not dimmed — the band lights what plays rather than greying what
does not. It is tempting the other way round, since a window starting past beat 0 has notes before
it that never sound; but for a repeated clip the pane past the window is not silence, it is the next
pass. One rule that reads as "this does not play" would be wrong in the commoner of the two cases,
and lighting the inside says the same thing without ever saying it about the wrong pixels.
