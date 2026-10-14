# The arpeggiator — why it is compiled, and where its time comes from

`Arpeggiator.h` holds a chord and plays it one note at a time; `ArpeggiatorPlugin.cpp` is the
built-in around it, `studio_arpeggiator`, scanned as a `midiEffect` and therefore filed under
`transformers/`. The module that names it is
`transformers/notes/arpeggiator` in the account's library.

## It is not a graph YET, and what is missing is one node

`transformers/` modules are normally a description: `@studio/dsp` emits JSON, `MidiGraphPlugin`
runs it, and adding a note transform costs no C++. This one is compiled, for one narrow reason.

The MIDI phase has a memory and a clock — `mhold` takes the held keys, `mstrike` plays them on
a step, and `midiGraph.md` is where that vocabulary is argued. The note repeater is three lines of
`@studio/dsp` on top of it. What an arpeggiator needs beyond that is the **walk**: it strikes ONE
slot per step, chosen by a direction and a number of octaves, where `mstrike` takes the whole held
set. That is a third node — `mwalk(direction, octaves)`, between hold and strike, narrowing what
strike sees — and not a mode flag on `mstrike`, which would make one node do two jobs.

Until it exists, the walk lives here: `Arpeggiator::noteFor` picks the slot, and the directions
below are its whole content. Porting it means moving that function into `DspGraph` and
proving the two sound identical, which nothing has done yet.

## The rate is a division, and the tempo is the edit's

`Rate` selects one of eight step lengths in **beats** (`ArpeggiatorPlugin::rateBeats`), not a
frequency: an arpeggiator that does not land on the grid is a tremolo with extra steps. Turning
beats into seconds needs a tempo, and the one read is `edit.tempoSequence.getTempo(0)` — the single
tempo a `ProjectDoc` carries (`EditBuilder.cpp` sets exactly that one). It is read once per block on
the audio thread, which is a plain number off a `CachedValue`; nothing here follows a tempo
sequence, because no document expresses one.

The floor of 20 BPM is what keeps a tempo of zero from making a step last forever. `Arpeggiator`
clamps again on its own side, between 5 ms and 8 s, because it is handed a number and cannot know
where it came from — under the floor the step loop would fill a block with notes.

## The note lasts half its step, unless a drawn step says otherwise

A preset holds every note for `Arpeggiator::gate`, half its step; a Custom pattern sets it per step
(below). A drawn gate is held between 5 % and 95 % (`minGate`, `maxGate`) because a full gate —
releasing the old note exactly where the new one starts — breaks on the one case an arpeggiator hits
constantly: a **single** held note, where the note-off and the note-on carry the same number at the
same timestamp, and what a synth does with that pair is its own business. The ceiling always leaves
a gap.

## The chord is eaten, and everything else keeps its place

What comes out is what the arpeggiator plays. Note-ons and note-offs are consumed to move the held
set; CCs, pitch bend and the rest pass through, **merged by timestamp** with the generated notes
rather than appended after them, because a message list out of order is a list something downstream
drops.

## It is an instrument, not a sequencer

A chord arriving on silence plays **at once**, from its bottom note, at the offset the key actually
landed on inside the block — not on the next beat. So it follows a hand rather than the bar, and the
price is that starting mid-bar leaves the pattern offset from the grid until the chord is let go.
Letting go releases the sounding note immediately: at the end of a step nobody is holding, that
note-off would be owed for as long as the silence lasts.

Nothing latches. There is no hold and no swing — each is a control that would have to be authored,
and this module answers the ones the panel names.

## Custom: a drawn pattern, kept as parameters

`Direction` 4 plays a DRAWN pattern rather than a walk: `Steps` (1–16) long, each `Step n` either a
rest (0) or the slot it plays, 1 being the lowest held note and the slots stacking up through the
octaves exactly as the presets' do. The pattern is parameters rather than a file or a blob, for one
reason: the panel's screen sets params by NAME and nothing else, so a drawing is heard live,
written to the node like a knob, and automatable step by step — the same path every other control
takes.

- **A slot is relative to the chord, not a pitch.** A pattern drawn as 1-3-2-3 plays any chord in
  that shape, which is what makes it an arpeggio pattern rather than a melody. A slot past the
  chord wraps round it (`(slot - 1) % count`), so a pattern drawn for four notes still plays on
  three instead of falling silent where the fourth would be.
- **A rest takes its step.** The clock moves and nothing sounds, so the pattern stays on the grid
  the rate describes.
- **Custom with no steps is `up`**, in `advance`: silence nobody chose is not a pattern.
- **Each step has a velocity and a gate**, `Velocity n` and `Gate n`. Velocity is a SHARE of how
  hard the chord was played (1, the default, plays it as played): an accent pattern that keeps the
  hand's dynamics, rather than a fixed level that throws them away. A step drawn at zero velocity is
  a rest — a note-on of velocity 0 is a note-off in MIDI. Gate is the share of the step the note
  lasts, 0.5 by default, the preset's value. Both are continuous parameters, so a bar is written and
  automated like a knob.
- **The drawn levels are the pattern's.** A preset plays as the hand did, at the default gate,
  whatever the bars say — a preset's steps are not the drawing's, so the drawing's levels have no
  step to belong to.
- **The steps survive leaving Custom.** Choosing a preset only changes `Direction`; going back to
  Custom finds the drawing where it was.

The screen (the library module's `widgets.js`) pictures a preset on the same grid, as it would play
a four-note chord — a preset depends on the chord held, which the panel cannot know. Under each
step sit its velocity bar and its gate bar. Drawing on a preset — a cell or a bar — copies what was
shown into the steps, the levels included, and switches `Direction` to Custom in the same
gesture, so the dropdown says Custom and the first stroke edits the pattern that was on screen
rather than a blank one. The fresh steps an untouched plugin holds are `up` over eight slots.

## The numbers a reader would get wrong

- **Sixteen held notes**, `Arpeggiator::maxHeld`. The array is fixed because the audio thread may not
  allocate; past sixteen, a chord is a stuck key.
- **Up-down does not repeat its ends** — the walk's period is `2n - 2`, so the top and bottom notes
  sound once per pass.
- **Octaves clamp at 127** rather than folding: a stack running off the keyboard repeats its top
  note, which is quieter than jumping an octave down mid-pattern.
- **A step that finds no room in the event buffer is skipped, never half-emitted.** The loop stops
  while two slots remain, so every note it turned on still gets its note-off — in the block after,
  if that is where it falls.

## What is tested, and what is not

`tests/Arpeggiator_test.cpp` runs in the **fast** binary (`studio_arp_tests`): `Arpeggiator.h` is
JUCE-free and header-only, like `TurntableLoop.h`, so the clock, the walk and the release are
covered with no audio device. The plugin around it is not — it needs a live `te::Edit`, the same gap
`turntable.md` describes.

The offline parameter table (`packages/song-schema/src/builtinParams.generated.ts`) is read out of a
**running** engine, and carries this plugin's parameters with their named settings — so the
builder can draw a panel for `@engine/arpeggiator` on a machine where no engine is up. Re-running
`npm run gen:builtin-params --workspace k7-runtime` is what any change to the parameters costs.
