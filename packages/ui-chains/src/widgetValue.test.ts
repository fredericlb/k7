// widgetValue.test.ts — a widget's value maths: the 0..1 travel, the text, the crossfade pair.

import type { WebWidget } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  pairValue,
  widgetDenorm,
  widgetNorm,
  widgetRange,
  widgetText,
  widgetTyped,
} from "./graph";

describe("widgetNorm / widgetDenorm round-trip", () => {
  const linear: WebWidget = { type: "knob", col: 0, row: 0, min: 0, max: 100 };
  const log: WebWidget = {
    type: "knob",
    col: 0,
    row: 0,
    min: 20,
    max: 20000,
    curve: "log",
  };

  it("is identity for a linear control", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1])
      expect(widgetNorm(linear, widgetDenorm(linear, t))).toBeCloseTo(t, 9);
  });

  it("is identity for a log control", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1])
      expect(widgetNorm(log, widgetDenorm(log, t))).toBeCloseTo(t, 9);
  });

  it("defaults an unspecified range to 0..1 (normalised plugin params)", () => {
    expect(widgetRange({ type: "knob", col: 0, row: 0 })).toEqual([0, 1]);
  });

  it("quantises to `step` when set", () => {
    const stepped: WebWidget = {
      type: "knob",
      col: 0,
      row: 0,
      min: 0,
      max: 10,
      step: 1,
    };
    expect(Number.isInteger(widgetDenorm(stepped, 0.57))).toBe(true);
  });
});

describe("widgetText", () => {
  const semitones: WebWidget = {
    type: "knob",
    col: 0,
    row: 0,
    min: -24,
    max: 24,
    step: 1,
  };

  it("reads a whole-number step as a signed integer when the range is bipolar", () => {
    expect(widgetText(semitones, 7)).toBe("+7");
    expect(widgetText(semitones, -12)).toBe("-12");
    expect(widgetText(semitones, 0)).toBe("0");
  });

  it("leaves a unipolar whole-number range unsigned", () => {
    expect(widgetText({ ...semitones, min: 1, max: 32 }, 16)).toBe("16");
  });

  it("keeps the decimals of a continuous control", () => {
    expect(widgetText({ type: "knob", col: 0, row: 0 }, 0.5)).toBe("0.50");
    expect(widgetText({ type: "knob", col: 0, row: 0 }, undefined)).toBe("–");
  });
});

describe("widgetTyped", () => {
  const w: WebWidget = {
    type: "knob",
    col: 0,
    row: 0,
    min: -24,
    max: 24,
    step: 1,
  };

  it("takes what is typed, with either decimal mark", () => {
    expect(widgetTyped({ type: "knob", col: 0, row: 0 }, "0.25")).toBe(0.25);
    expect(widgetTyped({ type: "knob", col: 0, row: 0 }, " 0,5 ")).toBe(0.5);
  });

  it("clamps to the control's range and rounds to its step", () => {
    expect(widgetTyped(w, "99")).toBe(24);
    expect(widgetTyped(w, "-99")).toBe(-24);
    expect(widgetTyped(w, "7.4")).toBe(7);
  });

  it("answers null for anything that is not a number, so nothing is sent", () => {
    expect(widgetTyped(w, "")).toBeNull();
    expect(widgetTyped(w, "loud")).toBeNull();
  });
});

describe("a crossfade knob", () => {
  const xf: WebWidget = {
    type: "knob",
    col: 0,
    row: 0,
    bind: "Wet Level",
    pair: "Dry Level",
  };

  it("keeps the power constant: wet² + dry² = 1 at every position", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const wet = widgetDenorm(xf, t);
      expect(wet ** 2 + pairValue(xf, wet) ** 2).toBeCloseTo(1, 9);
    }
  });

  it("is all dry at the left, all wet at the right, and -3 dB each in the middle", () => {
    expect(widgetDenorm(xf, 0)).toBeCloseTo(0, 9);
    expect(pairValue(xf, widgetDenorm(xf, 0))).toBeCloseTo(1, 9);
    expect(widgetDenorm(xf, 1)).toBeCloseTo(1, 9);
    expect(widgetDenorm(xf, 0.5)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(pairValue(xf, widgetDenorm(xf, 0.5))).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("reads its position back from the wet level alone", () => {
    for (const t of [0, 0.3, 0.5, 0.9, 1])
      expect(widgetNorm(xf, widgetDenorm(xf, t))).toBeCloseTo(t, 9);
  });

  it("is typed as a mix position in percent", () => {
    expect(widgetTyped(xf, "50")).toBeCloseTo(Math.SQRT1_2, 9);
    expect(widgetTyped(xf, "100")).toBeCloseTo(1, 9);
  });
});
