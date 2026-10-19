# Material

## clips/<id>.k7x

An audio clip — a source path, resolved against the project folder, and optionally a window into it.

```k7x schema=Clip
source("clips/kick.wav")
// The FILENAME is the id: this is clips/kick.k7x.

// from(0.25)   — start the sample 0.25s into the file, not at its beginning
// to(1.5)      — …and end it there, not at the file's end
// from("2:1")  — …or musically: bar 2, beat 1 OF THE FILE, at the project tempo
```

`from`/`to` trim the SAMPLE. They belong to the clip and not to a placement, so every track that plays the clip
plays the same trimmed material — say it once, in the file that owns it.

The spelling picks the unit: a bare number is **seconds**, tempo-independent, so the trim never moves; a
**timecode** string is musical, converted at the project tempo. Both, because both are right for different
material — a trimmed field recording wants seconds, a take played to the click wants "start at bar 2".

A timecode edge is a **position in the file**, read exactly like the `start:` beside it: `"1:1"` is the file's
beginning, `"2:1"` is its second bar. It is not a duration — "two bars in" would be `"3:1"`.

The window is the whole story about how long the clip sounds. A placement adds only where it starts and, with
`loop: N`, how many times the window is played — so its extent on the timeline is N × (`to` − `from`), and there
is nowhere for a second answer to live. With no `to`, the clip runs to the end of its file, which is the natural
way to place an untrimmed recording; a `loop` then has nothing to count and is refused when the project is read.

Opening the file shows its waveform fitted to the source's **whole** duration, with the window shaded, so the two
numbers can be placed by eye rather than guessed. Whole means whole: the window shades that picture and does not
also crop it, or trimming a clip would redraw the pane as the trim and leave nothing to judge putting it back.

Opening a **placed** clip — clicking it in the timeline — shows the other half instead: the window it repeats is
marked in violet, with a fainter line where each later pass begins, and the header counts them (`loop 4b × 3`).
That is what explains the pane's width, because it spans the clip's whole extent on the timeline: a clip looped
three times is one pass of material and two passes of the same thing again.

## sequences/<id>.k7x

A MIDI sequence holds its notes inline as compact {t,d,k,v} structs — t/d in beats, k a MIDI key, v an optional 0..1 velocity. Toggle Tracker to edit them on a grid.

`from`/`to` window the NOTES, exactly as a clip's window the sample: this sequence is that slice of them, and a
placement plays it `loop` times. Timecodes only, and positions — `"1:1"` is the first beat, `"5:1"` the fifth
bar. No bare numbers here, unlike a clip: a number in a clip means seconds into a file, and the same spelling
meaning beats one folder over is a rule only ever learned by getting it wrong.

Left out, the window is everything the notes cover, rounded up to the bar — so a two-bar pattern whose last hit
falls on the fourth sixteenth is still two bars long, and repeats of it do not drift.

The piano roll and the tracker mark that window the same way the waveform does — a lit band with its two edges
picked out — and here it says one more thing: notes lying **outside** it are in the file and are not played. A
window that starts past the first beat, or ends before the last hit, is exactly when that is worth seeing.

They mark it whether the sequence is PLACED on a track or opened as a file: `sequences/melody.k7x` in the editor
draws the same band, read from the text as you type it, and a `to:` reaching past the last note keeps its bars on
the grid rather than clipping them — the silence at the end is deliberate, and the band is what says so.

Each note also carries a thin line across it: its **velocity**, at the bottom of the note for 0 and at the top
for full. Drag **that line** up or down to change it (`sequence note velocity` on the command bar). A note that
says nothing about velocity draws at full and stays that way in the file — dragging one back to the top removes
the `v` rather than writing `v: 1`.

Every grip on a note is a place, which is what lets one box hold four gestures: the line sets the velocity, the
**body** moves the note — sideways in time, up and down to another pitch — and **either edge** stretches it.
Drag on an empty lane to draw a note, Backspace (or `x`) removes what the cursor is on or everything a
selection holds, and right-clicking one offers to remove or to split it. Backspace removes events on the
timeline the same way. Each of those is a command line, so each is one undo. Hold Ctrl to leave the grid; you hear
every note you press, through the track's own instrument.

```k7x schema=Sequence
// sequences/melody.k7x
// from("1:1")        — start at the sequence's own beginning (the default)
// to("3:1")          — …and end it at bar 3, whatever the last note does
// use_rack("drumrack") — a rack module whose symbols name these notes:
//                      the tracker then labels rows by symbol, not by key
notes([t(0).d(1).k(60), t(1).d(1).k(62), t(2).d(1).k(64), t(3).d(1).k(65)])
```

## curves/<id>.k7x — LFO

An automation curve. An LFO is generated: shape, frequency in cycles per BAR, optional phase. `polarity` decides how a module's automation maps it — unipolar sweeps the parameter's whole range, bipolar rides ± half a range around wherever the knob sits. `amplitude`, on every kind of curve, scales that: 0.5 sweeps half the range, or rides a quarter of it either side. `duration` stops an LFO that long after it starts — a length like `"2:0"` (two bars) — and the knob stays where it stopped; with a condition that retriggers it, every restart runs that long again. `cut` keeps one half of what the curve puts out: `positive` drops everything below 0, so a bipolar curve only ever pushes the knob up from where it sits; `negative` drops everything above 0, so it only pulls it down; `none`, the default, keeps both. A unipolar curve never goes below 0, so on one `positive` changes nothing and `negative` leaves it flat. `ui curve` opens an editor that writes all of these for you; `ui curve <id>` opens it on that curve.

```k7x schema=Curve
type("lfo")
shape("sine") // sine | triangle | saw | square
frequency(0.5) // cycles per bar
polarity("bipolar") // unipolar | bipolar
amplitude(0.8) // 0..1, the whole range at 1
cut("positive") // none | positive (keep 0..1) | negative (keep -1..0)
// phase(0.25)        — 0..1
// duration("2:0")    — how long it runs, a length — "0", the default, is for ever
```

## curves/<id>.k7x — custom

A drawn curve: timecoded points, interpolated between. At least one point; times are the same bars:beats:ticks the timeline uses, so they must be quoted.

```k7x schema=Curve
type("custom")
polarity("unipolar")
points([time("1:1:1").value(0), time("3:1:1").value(1), time("5:1:1").value(0)])
```

## curves/<id>.k7x — adsr

An envelope, in **milliseconds**, restarted every time an event fires it — where the two curves
above are functions of song time and run whether anything plays or not. Bind it like any other
curve; what makes it an envelope is that `trigger` names the module whose note-ons restart it,
and leaving that out means the module the curve drives (a filter envelope follows its own synth).

All four stages are durations, sustain included. A keyboard holds sustain until you let the key
go; this envelope is laid down in advance from the notes it will be fired by, so its length has
to be knowable — there is no note-off to wait for. `level` is the one value that is not a time:
where decay lands and sustain holds.

Milliseconds, and not bars, for the reason the LFO is the other way round: an envelope is a
gesture of the hand, and a 20 ms attack is 20 ms whatever the tempo.

```k7x schema=Curve
type("adsr")
attack(5) // ms, 0 is instant
decay(120) // ms, down to `level`
sustain(200) // ms — a HOLD, not a level
release(400) // ms, back to nothing
level(0.6) // 0..1, where decay lands
polarity("unipolar") // unipolar | bipolar
```

## curves/<id>.k7x — on/off

For a switch rather than a knob — a bypass, a toggle, a button. Drawn points like a custom curve,
but each is 0 or 1, and it HOLDS until the next one: the parameter flips, it never ramps. No
`amplitude` and no `polarity`, which a switch has no use for.

```k7x schema=Curve
type("onoff")
points([
  time("1:1:1").value(0),
  time("5:1:1").value(1), // on from bar 5
  time("9:1:1").value(0), // off again from bar 9
])
```

## curves/<id>.k7x — conditions

Any curve can say WHEN it runs, as a list of `conditions` — it runs while ANY of them holds. Four
kinds: `start` (from a moment on), `end` (until a moment),
`between` (both), and `event` — from an event the node the curve drives announces, which for now is
its note-on (`Note On`, however you spell it). Outside its condition a curve leaves its knob where it
reached. `retrigger: true` restarts the curve the moment its condition comes true — an LFO from the
top of its cycle, a drawn curve from its first point — where without it the curve carries on as if it
had been running all along; on an `event`, it restarts at every event rather than only the first.

```k7x schema=Curve
type("lfo")
shape("saw")
frequency(1)
conditions([
  type("between") // start | end | between | event
    .start("9:1:1") // start and end are timecodes; `start` and `end` alone take `at`
    .end("17:1:1")
    .retrigger(true), // restart when the condition comes true
  type("start") // …and again from bar 33, whichever holds
    .at("33:1:1"),
])
```

```k7x schema=Curve
type("custom")
points([time("1:1:1").value(0), time("1:3:1").value(1)])
conditions([type("event").event("Note On").retrigger(true)])
```

An envelope follows the same rules with its note-ons as triggers: a window keeps only the notes
inside it and cuts the envelope where the window ends; without `retrigger`, a note landing while
the envelope still runs is ignored rather than cutting it.

Two notes closer together than the envelope is long do not stack: the running one is cut where
the next fires. One automation lane holds one value, so there is nothing to sum. Per-note
modulation, where overlapping notes each keep their own envelope, is the plugin's own business.

## clips/<id>.k7x — corrected onsets

The engine detects onsets in the audio itself — the transient marks the slicer cuts on, and the grey
lines a clip draws. One threshold governs the whole file, so raising it finds more of them and lowering
it finds fewer. This block is for the ones it still gets wrong.

```k7x schema=Clip
source("clips/prise-01.wav")
onsets({
  added: [1.24], // a hit the detector missed, in SECONDS into the file
  removed: [3.51], // something it marked that is not a hit
})
```

What is stored is the **difference**, not the resulting list, and that is the point: the detected set is
rebuilt whenever the audio or the threshold changes, so a finished list would go stale the moment you
moved the sensitivity — and moving it is what the sensitivity is for. A correction outlives every
re-detection, because it says "there is also one here" and "there is not one there" rather than "here is
the answer".

Moving an onset is a removal and an addition, which is what moving it is. A time within 25 ms of an
existing onset means that one, so an approximate second is enough — and a hit re-detected a few
milliseconds away is still the hit you refused.

Seconds into the file, never a timecode: an onset is a fact about the material, and would slide out from
under it if it were musical and you edited the tempo.

The recorder writes these for you — the review screen at the end of a take draws the onsets over the
waveform and lets you drag, add and remove them — and `clip onset add|remove|move` is the same edit from
the command bar.

## clips/<id>.k7x — warped

A stretch map: `markers` pairs [timeline beat, source second], monotonic, at least two — the clip follows the song tempo instead of its own. Written by the importer, and editable with `clip warp <clip> <sec> <beat>`, which places a point or moves the one already at that second. `clip warp remove` drops one. Moving a point leaves its neighbours where they are, so only the two segments touching it change rate. A clip with no map gets its two anchors seeded on the first call — that map is an identity and changes no sound; the third point is what makes it a warp.

```k7x schema=Clip
source("clips/break.wav")
warp({ algorithm: "elastique", markers: [[0, 0], [4, 1.9382], [8, 3.8764]] })
```

### clips/<id>.k7x — the map kept, the stretching off

`disable: true` switches the stretching off **without losing the map**: no placement of the clip follows the grid any more, and the markers wait in the file for you to turn it back on. Use it when the same sample is wanted at its own rate — another song, another tempo, a one-shot — where deleting the map would mean computing it again. One event can refuse on its own instead, with `warp: false` beside it in the track file.

```k7x schema=Clip
source("clips/break.wav")
warp({ algorithm: "elastique", disable: true, markers: [[0, 0], [8, 3.8764]] })
```
