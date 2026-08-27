// The glyph table, and the one property that matters about it: the cursor is built from the SAME
// body the button draws. A test that only checked the strings existed would miss the whole point.

import { describe, expect, it } from "vitest";
import { cursorOf, MODE_GLYPHS } from "./modeIcons";
import { ROLL_MODES } from "./rollMode";
import { TOOLS } from "./timelineTools";
import { WAVE_MODES } from "./waveMode";

const NAMED = [...TOOLS, ...WAVE_MODES, ...ROLL_MODES];

describe("the glyph table", () => {
  it("draws every mode either surface can be in", () => {
    for (const m of NAMED) expect(MODE_GLYPHS[m], m).toBeDefined();
  });

  it("draws nothing the three surfaces do not name", () => {
    expect(Object.keys(MODE_GLYPHS).sort()).toEqual([...NAMED].sort());
  });

  it("paints with currentColor, which is what lets the cursor recolour it", () => {
    for (const m of NAMED)
      expect(MODE_GLYPHS[m].body, m).toContain("currentColor");
  });

  it("puts every hotspot inside its own viewBox", () => {
    for (const m of NAMED) {
      const g = MODE_GLYPHS[m];
      const [, , w, h] = g.vb.split(" ").map(Number);
      expect(g.hot[0], m).toBeGreaterThanOrEqual(0);
      expect(g.hot[1], m).toBeGreaterThanOrEqual(0);
      expect(g.hot[0], m).toBeLessThanOrEqual(w);
      expect(g.hot[1], m).toBeLessThanOrEqual(h);
    }
  });
});

describe("cursorOf", () => {
  it("answers nothing for a mode with no drawing", () => {
    expect(cursorOf("pencil")).toBeUndefined();
  });

  it("is a data URL with the hotspot after it, and a fallback behind that", () => {
    const c = cursorOf("cut") ?? "";
    expect(c.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(c.endsWith(`") ${MODE_GLYPHS.cut.hot.join(" ")}, auto`)).toBe(true);
  });

  /** The whole reason this file exists: one body, two readers. */
  it("carries the BUTTON's own path, so the two cannot drift apart", () => {
    const path = /d="([^"]+)"/.exec(MODE_GLYPHS.onsets.body)?.[1] ?? "";
    expect(path).toBeTruthy();
    expect(decodeURIComponent(cursorOf("onsets") ?? "")).toContain(path);
  });

  it("leaves no currentColor in the cursor, which would render as nothing standalone", () => {
    for (const m of NAMED)
      expect(decodeURIComponent(cursorOf(m) ?? ""), m).not.toContain(
        "currentColor",
      );
  });

  it("draws the glyph TWICE — a dark outline under a white fill, so it reads on either background", () => {
    const svg = decodeURIComponent(cursorOf("warp") ?? "");
    const path = /d="([^"]+)"/.exec(MODE_GLYPHS.warp.body)?.[1] ?? "";
    expect(svg.split(path).length - 1).toBe(2);
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain("#fff");
  });

  it("percent-encodes the `#` a colour carries, which would otherwise end the URL", () => {
    expect(cursorOf("warp")).not.toContain("#");
  });
});
