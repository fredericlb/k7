// geometry.test.ts — the card measurements: a node's size and its header's type.

import { describe, expect, it } from "vitest";
import {
  colsWidth,
  HEADER_MAX_PX,
  HEADER_MIN_PX,
  headerFontPx,
  moduleDisplayName,
  NODE_H,
  NODE_MIN_W,
  NODE_W,
  nodeSize,
  UI_PAD,
} from "./graph";

describe("nodeSize", () => {
  it("is the plain size with no UI, and grows to fit a UI grid", () => {
    expect(nodeSize(undefined)).toEqual({ w: NODE_W, h: NODE_H });
    expect(nodeSize({ cols: 4, rows: 3, widgets: {} }).h).toBeGreaterThan(
      NODE_H,
    );
  });

  it("is its GRID's width, not the no-panel minimum", () => {
    // NODE_W as a floor would park dead space beside every grid narrower than it.
    expect(nodeSize({ cols: 2, rows: 6, widgets: {} }).w).toBe(
      UI_PAD * 2 + colsWidth(2),
    );
    expect(nodeSize({ cols: 2, rows: 6, widgets: {} }).w).toBeLessThan(NODE_W);
  });

  it("still leaves the header something to be drawn in", () => {
    // The one case the grid alone cannot answer: one column is 48px, all of it header padding and glyph.
    expect(nodeSize({ cols: 1, rows: 2, widgets: {} }).w).toBe(NODE_MIN_W);
  });
});

describe("headerFontPx", () => {
  // A card is only as wide as its grid, so the header's size is fitted. See docs/graphBuild.md.
  it("leaves a short name at the ceiling — this shrinks, it does not enlarge", () => {
    expect(headerFontPx("eq", 200)).toBe(HEADER_MAX_PX);
  });

  it("shrinks a long name until it fits, rather than cutting it", () => {
    const wide = headerFontPx("vo_jo-mixer", 200);
    const narrow = headerFontPx("vo_jo-mixer", 60);
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBeGreaterThanOrEqual(HEADER_MIN_PX);
  });

  it("is monotonic in the NAME too: a longer one never gets a bigger size", () => {
    const sizes = ["a", "abcd", "abcdefgh", "abcdefghijklmnop"].map((n) =>
      headerFontPx(n, 84),
    );
    for (let i = 1; i < sizes.length; i++)
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
  });

  it("floors rather than vanishing — a smudge is worse than an ellipsis", () => {
    expect(headerFontPx("a-very-long-module-name-indeed", 20)).toBe(
      HEADER_MIN_PX,
    );
  });

  it("survives an empty label without dividing by zero", () => {
    expect(Number.isFinite(headerFontPx("", 84))).toBe(true);
  });
});

describe("moduleDisplayName", () => {
  // The header wears the LAST segment: a card is one word wide, and the prefix is the useless half.
  it("keeps the last segment of a namespaced reference", () => {
    expect(moduleDisplayName("@k7-core/audio/dynamics/comp-opto")).toBe(
      "comp-opto",
    );
  });

  it("leaves a bare name alone", () => {
    expect(moduleDisplayName("gain")).toBe("gain");
  });

  it("falls back to the whole reference rather than showing nothing", () => {
    expect(moduleDisplayName("@k7-core/audio/")).toBe("@k7-core/audio/");
    expect(moduleDisplayName("")).toBe("");
  });
});
