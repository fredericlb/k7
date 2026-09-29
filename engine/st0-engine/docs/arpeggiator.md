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

Until it exists, the walk lives here: `Arpeggiator::noteFor` picks the slot, and the four
directions below are its whole content. Porting it means moving that function into `DspGraph` and
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

## The note lasts half its step

The gate is fixed at `Arpeggiator::gate`, and it is not a control: three choices were asked for, and
a fourth knob for something most players never move is a worse panel. Half is the value because the
alternative — a full gate, releasing the old note exactly where the new one starts — breaks on the
one case an arpeggiator hits constantly: a **single** held note, where the note-off and the note-on
carry the same number at the same timestamp, and what a synth does with that pair is its own
business. Half a step always leaves the gap.

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

Nothing latches. There is no hold, no swing, no velocity pattern and no rest — each is a control
that would have to be authored, and this module answers the three the panel names.

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
**running** engine, and carries this plugin's three parameters with their named settings — so the
builder can draw a panel for `@engine/arpeggiator` on a machine where no engine is up. Re-running
`npm run gen:builtin-params --workspace st0-engine` is what any change to the parameters costs.
