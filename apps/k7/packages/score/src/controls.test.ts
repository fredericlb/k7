// The toolbar's numbers, off the DOM: bounds, the zoom ladder, and how a shift reads.

import { describe, expect, it } from "vitest";
import {
  clampTranspose,
  formatTranspose,
  stepZoom,
  TRANSPOSE_MAX,
  TRANSPOSE_MIN,
  ZOOM_STEPS,
} from "./controls.ts";

describe("clampTranspose", () => {
  it("keeps a shift within an octave either way", () => {
    expect(clampTranspose(3)).toBe(3);
    expect(clampTranspose(40)).toBe(TRANSPOSE_MAX);
    expect(clampTranspose(-40)).toBe(TRANSPOSE_MIN);
  });
});

describe("stepZoom", () => {
  it("walks the ladder and stops at its ends", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1], 1)).toBe(2);
    expect(stepZoom(ZOOM_STEPS[0], -1)).toBe(0.5);
  });

  it("lands back on the ladder from a value off it", () => {
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
  });
});

describe("formatTranspose", () => {
  it("reads as sharps and flats", () => {
    expect(formatTranspose(0)).toBe("0");
    expect(formatTranspose(2)).toBe("♯2");
    expect(formatTranspose(-3)).toBe("♭3");
  });
});
