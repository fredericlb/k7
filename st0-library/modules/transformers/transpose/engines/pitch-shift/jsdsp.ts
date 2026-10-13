// A MIDI pitch shifter: every note moved by a whole number of semitones.
//
// One parameter on purpose. Two octaves either way is the useful range for doubling a part an octave down or
// harmonising a fifth up; past that a transposed line stops sounding like the same instrument.
//
// Notes pushed off either end of the keyboard are CLAMPED rather than dropped (see DspGraph::processMidi):
// dropping a note-on would leave its note-off behind and hang the voice for good.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const semitones = g.param("Semitones", { min: -24, max: 24, default: 0 });
  g.transpose(g.midi(), semitones);
};
