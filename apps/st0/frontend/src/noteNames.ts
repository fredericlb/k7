// noteNames.ts — one spelling of a MIDI key, for every view that labels or shades a row of keys.
// Sharps throughout and MIDI 60 is C4; the tuner spells its own, with ♯, in IoPanel.

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** A key's pitch class, 0 for every C — negative keys included. */
export const pc = (k: number) => ((k % 12) + 12) % 12;

/** `60` → `C4`. */
export const noteName = (k: number) =>
  `${NAMES[pc(k)]}${Math.floor(k / 12) - 1}`;

/** Whether a key is a black one on a keyboard. */
export const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(pc(k));
