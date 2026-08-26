// Laying PL8's tempo over the analysis. The audit this answers: the grid is deduced and was not
// correctable, while the doc itself showed a song whose detected tempo is wrong.
//
// The correction lives with the RECORD (pl8's song.yaml) and not with the set: 87 BPM is 87 BPM in
// every project that plays it. See ../../mediatek/docs/songs.md.
//
// What would be wrong silently here: a correction that moves the fader somebody has already set,
// one that leaves `natural` alone (so the deck plays at the wrong RATE while showing the right
// number), and a corrected downbeat that still carries the guess's "not confident" flag.

import { describe, expect, it } from "vitest";
import type { DeckTempo } from "./deck";
import { corrected } from "./useDeckSet";

/** As the analysis hands it over: a wrongly-doubled 174 on an 87 BPM record. */
const measured: DeckTempo = {
  natural: 174,
  seconds: 200,
  target: 174,
  phase: 0.42,
};

describe("corrected", () => {
  it("is the analysis itself when the set says nothing", () => {
    expect(corrected(measured, undefined)).toBe(measured);
    expect(corrected(measured, {})).toBe(measured);
  });

  it("replaces what the record IS, not just what it shows", () => {
    // `natural` is the divisor in `Rate = target / natural`. Correcting only the label would leave
    // the platter running at the wrong speed while the fader read right.
    const fixed = corrected(measured, { bpm: 87 });
    expect(fixed.natural).toBe(87);
    expect(fixed.target).toBe(87);
  });

  it("does NOT move a fader somebody has already set", () => {
    // A moved fader is a decision. Halving the detected tempo must not throw away a deck that was
    // deliberately pulled to 176 to ride another record.
    const nudged = { ...measured, target: 176 };
    const fixed = corrected(nudged, { bpm: 87 });
    expect(fixed.natural).toBe(87);
    expect(fixed.target).toBe(176);
  });

  it("leaves the analysis's own downbeat alone", () => {
    // pl8 holds a tempo and a key, not a downbeat: where beat one falls is still the Rayleigh
    // test's answer, and a corrected tempo must not quietly move it.
    expect(corrected(measured, { bpm: 87 }).phase).toBe(0.42);
  });

  it("keeps the length, which is a fact about the FILE and never a correction", () => {
    expect(corrected(measured, { bpm: 87 }).seconds).toBe(200);
  });
});
