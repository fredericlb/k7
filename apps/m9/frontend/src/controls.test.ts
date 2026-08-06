import { describe, expect, it } from "vitest";
import {
  DECK_PREFIX,
  denormalise,
  isPerDeck,
  MIX_CONTROLS,
  mixControl,
  normalise,
} from "./controls";
import { BPM_RANGE } from "./deck";

describe("the desk's controls", () => {
  it("has an id for every one of them, and no duplicates", () => {
    const ids = MIX_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The list a binding may name. Written out so ADDING a control is a deliberate edit here
    // rather than something that quietly changes what a controller.yaml can say.
    expect(ids).toEqual([
      "crossfade",
      "deck.tempo",
      "deck.sync",
      "transport",
      "listen",
    ]);
  });

  it("tells a per-deck control from a desk-wide one", () => {
    // The distinction a shared map depends on: one `controller.yaml` serves every instance of
    // a module, so a tempo binding has to mean "this instance's deck" and not deck A.
    expect(isPerDeck("deck.tempo")).toBe(true);
    expect(isPerDeck("deck.sync")).toBe(true);
    expect(isPerDeck("crossfade")).toBe(false);
    expect(isPerDeck("transport")).toBe(false);
  });

  it("keeps the prefix as the ONLY marker of a relative id", () => {
    for (const c of MIX_CONTROLS)
      expect(isPerDeck(c.id)).toBe(c.id.startsWith(DECK_PREFIX));
  });

  it("gives the tempo fader the module's own range, not one of its own", () => {
    // A binding must not be able to ask for a tempo the module's knob refuses to draw.
    expect(mixControl("deck.tempo")?.range).toEqual(BPM_RANGE);
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
  const tempo = mixControl("deck.tempo");
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
