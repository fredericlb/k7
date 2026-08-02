// Note maths for the guitar tuner: turning a detected frequency into a note +
// cents deviation, and finding the nearest standard-tuning string. Frequency
// detection itself is done by the `pitchy` library (McLeod Pitch Method); this
// module stays pure so it can be unit-tested.

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export interface GuitarString {
  label: string; // unique id incl. octave, e.g. "E2"
  note: string; // display letter, e.g. "E"
  freq: number; // target frequency in Hz
}

// Standard tuning, low to high.
export const GUITAR_STRINGS: GuitarString[] = [
  { label: "E2", note: "E", freq: 82.41 },
  { label: "A2", note: "A", freq: 110.0 },
  { label: "D3", note: "D", freq: 146.83 },
  { label: "G3", note: "G", freq: 196.0 },
  { label: "B3", note: "B", freq: 246.94 },
  { label: "E4", note: "E", freq: 329.63 },
];

export interface NoteReading {
  name: string; // e.g. "A"
  octave: number; // scientific-pitch octave, e.g. 4
  cents: number; // signed deviation from the exact note, −50..+50
  midi: number; // nearest MIDI note number
}

/** Map a frequency to the nearest note name, octave and cents deviation (A4=440). */
export function freqToNote(freq: number): NoteReading {
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { name, octave, cents, midi };
}

/** The standard-tuning string whose pitch is closest (in cents) to `freq`. */
export function nearestString(freq: number): GuitarString {
  let best = GUITAR_STRINGS[0];
  let bestDiff = Infinity;
  for (const s of GUITAR_STRINGS) {
    const diff = Math.abs(1200 * Math.log2(freq / s.freq));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}
