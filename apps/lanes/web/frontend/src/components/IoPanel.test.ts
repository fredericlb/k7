import { describe, expect, it } from "vitest";
import { noteOf } from "./IoPanel";

// The engine reports a FREQUENCY and nothing else, so every wrong note a user could see is born here. The two
// things worth pinning are the octave boundary (it turns over at C, not at A, which is the classic off-by-one)
// and the sign of the detuning — a tuner that says "sharp" when you are flat is worse than no tuner.

describe("the nearest note to a frequency", () => {
  const name = (hz: number) => {
    const n = noteOf(hz);
    return n ? `${n.name}${n.octave}` : null;
  };

  it("names concert A and the strings of a guitar", () => {
    expect(name(440)).toBe("A4");
    expect(name(82.41)).toBe("E2");
    expect(name(110)).toBe("A2");
    expect(name(146.83)).toBe("D3");
    expect(name(196)).toBe("G3");
    expect(name(246.94)).toBe("B3");
    expect(name(329.63)).toBe("E4");
  });

  it("turns the octave over at C, not at A", () => {
    // B3 -> C4 is where the number changes. Naming this off A4 (the reference) is the mistake
    // that puts every note between C and A in the wrong octave.
    expect(name(246.94)).toBe("B3");
    expect(name(261.63)).toBe("C4");
    expect(name(523.25)).toBe("C5");
  });

  it("reads dead-on as zero cents", () => {
    expect(noteOf(440)?.cents).toBe(0);
    expect(noteOf(261.63)?.cents).toBe(0);
  });

  it("signs the detuning the way a player reads it — sharp is positive", () => {
    // A quarter-tone is 50 cents; half of that either way.
    expect(noteOf(440 * 2 ** (25 / 1200))?.cents).toBe(25);
    expect(noteOf(440 * 2 ** (-25 / 1200))?.cents).toBe(-25);
    // …and the note stays A4 across the whole band it owns, rather than flipping early.
    expect(name(440 * 2 ** (49 / 1200))).toBe("A4");
    expect(name(440 * 2 ** (-49 / 1200))).toBe("A4");
  });

  it("never reports beyond half a semitone — past that the next note is nearer", () => {
    for (let cents = -49; cents <= 49; cents += 7) {
      const n = noteOf(440 * 2 ** (cents / 1200));
      expect(Math.abs(n!.cents)).toBeLessThanOrEqual(50);
    }
  });

  it("says nothing for the no-note answer the engine sends", () => {
    // 0 is what the engine reports for silence, noise, or a chord — it must not become a note.
    expect(noteOf(0)).toBe(null);
    expect(noteOf(-1)).toBe(null);
    expect(noteOf(Number.NaN)).toBe(null);
    expect(noteOf(Number.POSITIVE_INFINITY)).toBe(null);
  });
});
