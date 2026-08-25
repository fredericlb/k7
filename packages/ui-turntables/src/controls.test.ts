import { describe, expect, it } from "vitest";
import { denormalise, MIX_CONTROLS, mixControl, normalise } from "./controls";
import { BPM_RANGE, DECKS } from "./deck";

describe("the desk's controls", () => {
  it("has an id for every one of them, and no duplicates", () => {
    const ids = MIX_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The list a binding may name, written out so adding a control is a deliberate edit here.
    expect(ids).toEqual([
      "crossfade",
      "deckA.tempo",
      "deckA.sync",
      "deckA.eqLow",
      "deckA.eqMid",
      "deckA.eqHigh",
      "deckA.filter",
      "deckA.stemDrums",
      "deckA.stemBass",
      "deckA.stemOther",
      "deckA.stemVocals",
      "deckB.tempo",
      "deckB.sync",
      "deckB.eqLow",
      "deckB.eqMid",
      "deckB.eqHigh",
      "deckB.filter",
      "deckB.stemDrums",
      "deckB.stemBass",
      "deckB.stemOther",
      "deckB.stemVocals",
      "transport",
      "listen",
    ]);
  });

  it("gives the stem levels a proportion, resting at unity in the middle", () => {
    // A proportion and not decibels: left takes the part out, right doubles it, and 0 is reachable.
    for (const deck of DECKS)
      for (const stem of ["stemDrums", "stemBass", "stemOther", "stemVocals"]) {
        const c = mixControl(`${deck}.${stem}`);
        expect(c?.range, `${deck}.${stem}`).toEqual([0, 2]);
        // Home is the part as it was cut, and it sits in the CENTRE of the travel.
        expect(c?.home, `${deck}.${stem}`).toBe(1);
        expect(normalise(c!, 1)).toBe(0.5);
      }
  });

  it("names its own module per stem, unlike the EQ's three", () => {
    // A level belongs to the lane playing that one part, so each names a module of its own.
    for (const deck of DECKS)
      expect(mixControl(`${deck}.stemBass`)?.wants).toBe("stem");
  });

  it("gives the FILTER the module's own signed range too", () => {
    // Its own scale, ±100 against the EQ's ±20 dB, and centred: a filter at 0 is inaudible, not off.
    for (const deck of DECKS) {
      const c = mixControl(`${deck}.filter`);
      expect(c?.range).toEqual([-100, 100]);
      expect(normalise(c!, 0)).toBeCloseTo(0.5);
    }
  });

  it("gives the EQ knobs the module's range, with flat in the MIDDLE", () => {
    // dB and not 0..1, symmetric so that a knob at the centre of its travel is flat.
    for (const deck of DECKS)
      for (const band of ["eqLow", "eqMid", "eqHigh"]) {
        const c = mixControl(`${deck}.${band}`);
        expect(c?.range).toEqual([-20, 20]);
        expect(c?.home).toBe(0);
        expect(normalise(c!, 0)).toBeCloseTo(0.5);
      }
  });

  it("names one control each, absolutely", () => {
    // Not `deck.tempo` resolved against a deck: the project names `tempoA` and `tempoB` outright.
    expect(mixControl("deckA.tempo")).toBeDefined();
    expect(mixControl("deckB.tempo")).toBeDefined();
    expect(mixControl("deck.tempo")).toBeUndefined();
  });

  it("grows a control per DECK rather than listing two", () => {
    // A third deck is expressible in the file format, and hardcoding two leaves it unbindable.
    for (const deck of DECKS) {
      expect(mixControl(`${deck}.tempo`)).toBeDefined();
      expect(mixControl(`${deck}.sync`)).toBeDefined();
    }
  });

  it("gives the tempo fader the module's own range, not one of its own", () => {
    // A binding must not be able to ask for a tempo the module's knob refuses to draw.
    expect(mixControl("deckA.tempo")?.range).toEqual(BPM_RANGE);
  });

  it("answers nothing for an id nobody defined", () => {
    // A typo: undefined lets the caller say so, where a fallback would bind the wrong thing.
    expect(mixControl("deck.pitch")).toBeUndefined();
    expect(mixControl("")).toBeUndefined();
  });
});

describe("a control's position as a unit value", () => {
  const fader = mixControl("crossfade");
  const tempo = mixControl("deckA.tempo");
  if (!fader || !tempo)
    throw new Error("the fixtures are the controls themselves");

  it("puts each end at 0 and 1", () => {
    expect(normalise(fader, 0)).toBe(0);
    expect(normalise(fader, 1)).toBe(1);
    expect(normalise(tempo, BPM_RANGE[0])).toBe(0);
    expect(normalise(tempo, BPM_RANGE[1])).toBe(1);
  });

  it("scales by the control's OWN range", () => {
    // 155 is the middle of 10..300: the same gesture as the crossfader's 0.5, hence normalising first.
    expect(normalise(fader, 0.5)).toBeCloseTo(0.5);
    expect(normalise(tempo, 155)).toBeCloseTo(0.5);
  });

  it("clamps rather than letting a value past the ends", () => {
    // Out of range would pin a knob at the widget's limit while the number says something else.
    expect(normalise(fader, 2)).toBe(1);
    expect(normalise(fader, -1)).toBe(0);
    expect(normalise(tempo, 5000)).toBe(1);
  });

  it("round-trips, which is what an echo back to the fader needs", () => {
    for (const v of [0, 0.25, 0.5, 1])
      expect(denormalise(fader, normalise(fader, v))).toBeCloseTo(v);
    for (const v of [10, 123.31, 300])
      expect(denormalise(tempo, normalise(tempo, v))).toBeCloseTo(v);
  });
});
