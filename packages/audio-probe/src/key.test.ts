// Detecting a key, against material whose key is KNOWN because it was synthesised.
//
// The médiathèque on this machine cannot supply ground truth — 302 records, not one `TKEY` tag —
// so real-world accuracy is NOT measured here and this file does not claim it. What it does claim
// is the part that would be wrong silently: a chroma bin mapped to the wrong pitch class, a profile
// rotated the wrong way, and a Camelot wheel whose neighbours are not neighbours. Those survive
// listening tests and die to transposition.
//
// The strongest test in here is TRANSPOSITION INVARIANCE: the same progression in all twelve keys
// must come back as all twelve keys. An off-by-one in the rotation passes a single-key test and
// fails that one.

import { describe, expect, it } from "vitest";
import {
  camelot,
  chromagram,
  compatible,
  type DetectedKey,
  KRUMHANSL,
  keyName,
  keyOf,
  PITCH_CLASSES,
  TEMPERLEY,
} from "./key";

const RATE = 22050;

/** A note's frequency, from a semitone offset above C4. */
const hz = (semitone: number) => 261.6255653 * 2 ** (semitone / 12);

/** A chord, as a few sines with a couple of harmonics — closer to an instrument than a pure tone. */
function chord(
  into: Float32Array,
  at: number,
  length: number,
  semis: number[],
) {
  for (const s of semis)
    for (const [partial, gain] of [
      [1, 1],
      [2, 0.5],
      [3, 0.25],
    ] as const)
      for (let i = 0; i < length && at + i < into.length; i++)
        into[at + i] +=
          gain * 0.1 * Math.sin((2 * Math.PI * hz(s) * partial * i) / RATE);
}

/** I–V–vi–IV in `tonic`, the most ordinary progression there is, three seconds of it. */
function progression(tonic: number): Float32Array {
  const bar = Math.floor(RATE * 0.75);
  const out = new Float32Array(bar * 4);
  const major = (root: number) => [root, root + 4, root + 7];
  const minor = (root: number) => [root, root + 3, root + 7];
  const chords = [
    major(tonic), // I
    major(tonic + 7), // V
    minor(tonic + 9), // vi
    major(tonic + 5), // IV
  ];
  chords.forEach((c, i) => chord(out, bar * i, bar, c));
  return out;
}

/** A minor progression WITH its dominant: i–iv–V–i. The V's leading tone is what makes the key
 *  decidable — it is the one note the relative major does not contain. */
function minorProgression(tonic: number): Float32Array {
  const bar = Math.floor(RATE * 0.75);
  const out = new Float32Array(bar * 4);
  const major = (root: number) => [root, root + 4, root + 7];
  const minor = (root: number) => [root, root + 3, root + 7];
  const chords = [
    minor(tonic),
    minor(tonic + 5),
    major(tonic + 7),
    minor(tonic),
  ];
  chords.forEach((c, i) => chord(out, bar * i, bar, c));
  return out;
}

/** …and one WITHOUT it: i–VI–III–VII, pure Aeolian. Same seven notes as the relative major. */
function aeolian(tonic: number): Float32Array {
  const bar = Math.floor(RATE * 0.75);
  const out = new Float32Array(bar * 4);
  const major = (root: number) => [root, root + 4, root + 7];
  const minor = (root: number) => [root, root + 3, root + 7];
  const chords = [
    minor(tonic),
    major(tonic + 8),
    major(tonic + 3),
    major(tonic + 10),
  ];
  chords.forEach((c, i) => chord(out, bar * i, bar, c));
  return out;
}

const detect = (pcm: Float32Array, profile = TEMPERLEY) =>
  keyOf(chromagram(pcm, RATE), profile);

describe("the chromagram", () => {
  it("puts a pure note in ITS pitch class and not a neighbour", () => {
    // The bin mapping, on its own. An off-by-one here moves every key by a semitone.
    for (const semitone of [0, 3, 7, 11]) {
      const pcm = new Float32Array(RATE);
      chord(pcm, 0, pcm.length, [semitone]);
      const chroma = chromagram(pcm, RATE);
      const loudest = chroma.indexOf(Math.max(...chroma));
      expect(PITCH_CLASSES[loudest], `semitone ${semitone}`).toBe(
        PITCH_CLASSES[semitone % 12],
      );
    }
  });

  it("says nothing about silence, rather than something arbitrary", () => {
    const chroma = chromagram(new Float32Array(RATE), RATE);
    expect(chroma.every((v) => v === 0)).toBe(true);
    expect(keyOf(chroma)).toBeNull();
  });

  it("answers for audio too short to hold one frame", () => {
    expect(chromagram(new Float32Array(16), RATE).every((v) => v === 0)).toBe(
      true,
    );
  });
});

describe("keyOf", () => {
  it("finds the tonic of a major progression", () => {
    const key = detect(progression(0));
    expect(key && PITCH_CLASSES[key.tonic]).toBe("C");
    expect(key?.mode).toBe("major");
  });

  it("is TRANSPOSITION INVARIANT — twelve keys, twelve answers", () => {
    // The test an off-by-one cannot survive. A rotation applied the wrong way round still passes
    // the C-major case above, because C is its own rotation by zero.
    const wrong: string[] = [];
    for (let tonic = 0; tonic < 12; tonic++) {
      const key = detect(progression(tonic));
      if (!key || key.tonic !== tonic % 12 || key.mode !== "major")
        wrong.push(
          `${PITCH_CLASSES[tonic]} major -> ${key ? keyName(key) : "nothing"}`,
        );
    }
    expect(wrong).toEqual([]);
  });

  it("tells a minor progression from a major one, WHEN the dominant is there", () => {
    // The mode is what key detection gets wrong most, so it gets its own case in all twelve.
    const wrong: string[] = [];
    for (let tonic = 0; tonic < 12; tonic++) {
      const key = detect(minorProgression(tonic));
      if (!key || key.tonic !== tonic % 12 || key.mode !== "minor")
        wrong.push(
          `${PITCH_CLASSES[tonic]} minor -> ${key ? keyName(key) : "nothing"}`,
        );
    }
    expect(wrong).toEqual([]);
  });

  it("confuses a dominant-less minor with its RELATIVE MAJOR — measured, not assumed", () => {
    // i–VI–III–VII in C minor is exactly the notes of E flat major. No chromagram can tell them
    // apart, because there is nothing to tell: the difference is which chord feels like home, and
    // that is not in the pitch-class histogram. This is the documented failure of the method, and
    // pinning it is how we notice if it ever gets worse than "the relative".
    for (let tonic = 0; tonic < 12; tonic++) {
      const key = detect(aeolian(tonic));
      expect(key, PITCH_CLASSES[tonic]).not.toBeNull();
      const relative = (tonic + 3) % 12;
      // Either the right answer, or its relative major. Never a third thing.
      const ok =
        (key?.tonic === tonic && key?.mode === "minor") ||
        (key?.tonic === relative && key?.mode === "major");
      expect(ok, `${PITCH_CLASSES[tonic]} minor -> ${keyName(key)}`).toBe(true);
    }
  });

  it("…and the confusion COSTS A DJ NOTHING, which is why it is tolerable", () => {
    // A key and its relative share a Camelot hour and differ only by letter — and the wheel calls
    // those compatible. So the most common error lands on a code that mixes with the right one.
    for (let tonic = 0; tonic < 12; tonic++) {
      const truth = camelot({ tonic, mode: "minor", margin: 1 });
      const got = camelot(detect(aeolian(tonic)));
      expect(compatible(truth, got), `${truth} vs ${got}`).toBe(true);
    }
  });

  it("reports a SMALLER margin for something ambiguous than for a clear progression", () => {
    // The margin is the only thing standing between a guess and a lie on screen.
    const clear = detect(progression(0));
    const chromatic = new Float32Array(RATE * 2);
    // Every pitch class equally: there is no key here, and the detector must not sound sure.
    chord(
      chromatic,
      0,
      chromatic.length,
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    );
    const muddle = detect(chromatic);
    expect(clear?.margin).toBeGreaterThan(muddle?.margin ?? 1);
  });

  it("agrees with itself across the two profiles on an unambiguous case", () => {
    // Where the profiles disagree is real material; on a plain I–V–vi–IV they must not.
    for (let tonic = 0; tonic < 12; tonic++) {
      const t = detect(progression(tonic), TEMPERLEY);
      const k = detect(progression(tonic), KRUMHANSL);
      expect(t?.tonic, PITCH_CLASSES[tonic]).toBe(k?.tonic);
    }
  });
});

describe("the Camelot wheel", () => {
  const key = (tonic: number, mode: "major" | "minor"): DetectedKey => ({
    tonic,
    mode,
    margin: 1,
  });

  it("puts C major at 8B and A minor at 8A — the pair everyone checks", () => {
    expect(camelot(key(0, "major"))).toBe("8B");
    expect(camelot(key(9, "minor"))).toBe("8A");
  });

  it("walks in FIFTHS, which is what makes ±1 mean anything", () => {
    // G is a fifth above C, so it must be the next hour along — not the next semitone.
    expect(camelot(key(7, "major"))).toBe("9B");
    expect(camelot(key(5, "major"))).toBe("7B");
  });

  it("gives all 24 keys a distinct code", () => {
    const all = new Set<string>();
    for (let t = 0; t < 12; t++)
      for (const m of ["major", "minor"] as const) all.add(camelot(key(t, m)));
    expect(all.size).toBe(24);
  });

  it("mixes with itself, its neighbours and its relative — and nothing else", () => {
    expect(compatible("8B", "8B")).toBe(true);
    expect(compatible("8B", "9B")).toBe(true);
    expect(compatible("8B", "7B")).toBe(true);
    expect(compatible("8B", "8A")).toBe(true); // the relative minor
    expect(compatible("8B", "10B")).toBe(false);
    expect(compatible("8B", "9A")).toBe(false);
  });

  it("wraps: 12 and 1 are neighbours, because it is a wheel", () => {
    expect(compatible("12A", "1A")).toBe(true);
    expect(compatible("1A", "12A")).toBe(true);
    expect(compatible("12A", "2A")).toBe(false);
  });

  it("says nothing for nothing", () => {
    expect(camelot(null)).toBe("");
    expect(keyName(null)).toBe("");
    expect(compatible("", "8B")).toBe(false);
  });
});
