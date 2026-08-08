import { describe, expect, it } from "vitest";
import { denormalise, MIX_CONTROLS, mixControl, normalise } from "./controls";
import { BPM_RANGE, DECKS } from "./deck";

describe("the desk's controls", () => {
  it("has an id for every one of them, and no duplicates", () => {
    const ids = MIX_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The list a binding may name. Written out so ADDING a control is a deliberate edit here
    // rather than something that quietly changes what a controller.yaml can say.
    expect(ids).toEqual([
      "crossfade",
      "deckA.tempo",
      "deckA.sync",
      "deckA.eqLow",
      "deckA.eqMid",
      "deckA.eqHigh",
      "deckB.tempo",
      "deckB.sync",
      "deckB.eqLow",
      "deckB.eqMid",
      "deckB.eqHigh",
      "transport",
      "listen",
    ]);
  });

  it("gives the EQ knobs the module's range, with flat in the MIDDLE", () => {
    // dB, not 0..1 — the mixer strip's rule, where sending 0.5 for "half" looks right and is
    // six decibels wrong. Symmetric so that a knob at the centre of its travel is flat, which
    // is what an EQ knob has to mean at a glance.
    for (const deck of DECKS)
      for (const band of ["eqLow", "eqMid", "eqHigh"]) {
        const c = mixControl(`${deck}.${band}`);
        expect(c?.range).toEqual([-20, 20]);
        expect(c?.home).toBe(0);
        expect(normalise(c!, 0)).toBeCloseTo(0.5);
      }
  });

  it("names one control each, absolutely", () => {
    // Not `deck.tempo` resolved against whichever deck: the bindings live in the PROJECT's
    // views/mix.yaml, which names `tempoA` and `tempoB` on separate lines, so there is
    // nothing left to resolve and an id means exactly one control.
    expect(mixControl("deckA.tempo")).toBeDefined();
    expect(mixControl("deckB.tempo")).toBeDefined();
    expect(mixControl("deck.tempo")).toBeUndefined();
  });

  it("grows a control per DECK rather than listing two", () => {
    // A third deck is expressible in the file format, so the desk must not hardcode two or
    // the new deck would be silently unbindable.
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
    // A typo in a controller.yaml. Undefined lets the caller say so; a fallback control would
    // bind the wrong thing and look like it worked.
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
    // 155 is the middle of 10..300 — the crossfader's 0.5 and the tempo's 155 are the same
    // gesture, which is the whole reason a binding normalises before it scales.
    expect(normalise(fader, 0.5)).toBeCloseTo(0.5);
    expect(normalise(tempo, 155)).toBeCloseTo(0.5);
  });

  it("clamps rather than letting a value past the ends", () => {
    // Out of range would push a param past the widget that draws it: a knob pinned at its
    // limit while the number says something else.
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
