// What the icon has to keep saying. The badge colour IS the information, so the test that
// matters most is that two states differ in colour — that is exactly what a macOS template
// image would destroy while looking better than before.

import { describe, expect, it } from "vitest";
import { type IconState, renderIcon, SPINNER_FRAMES } from "./iconRaster.ts";

const N = 44;
const px = (buf: Buffer, u: number, v: number) => {
  const i = ((Math.round(v * N) * N + Math.round(u * N)) * 4) | 0;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]] as number[];
};
const render = (s: IconState, dark = true, attention = false) =>
  renderIcon(s, dark, attention, N);

/** Which channel dominates — enough to tell green from red from amber without pinning bytes. */
function hue(p: number[]): "red" | "green" | "blue" | "grey" {
  const [r, g, b] = p as [number, number, number];
  if (r > g + 40 && r > b + 40) return "red";
  if (g > r + 40 && g > b + 40) return "green";
  if (b > r + 40 && b > g + 40) return "blue";
  return "grey";
}

describe("the tray mark", () => {
  it("is n×n RGBA", () => {
    expect(render({ kind: "running" }).length).toBe(N * N * 4);
  });

  it("shows a green badge running and a red one stopped", () => {
    expect(hue(px(render({ kind: "running" }), 0.82, 0.82))).toBe("green");
    expect(hue(px(render({ kind: "stopped" }), 0.82, 0.82))).toBe("red");
  });

  it("keeps running and stopped DISTINGUISHABLE — the setTemplateImage trap", () => {
    const a = render({ kind: "running" });
    const b = render({ kind: "stopped" });
    // A template image would make these identical: same alpha, colour discarded.
    expect(a.equals(b)).toBe(false);
    const differing = [...a.keys()].filter(
      (i) => i % 4 !== 3 && a[i] !== b[i],
    ).length;
    expect(differing).toBeGreaterThan(50);
  });

  it("flips the ink with the menu bar, leaving the badge alone", () => {
    const onBar = [0.3, 0.3] as const;
    const light = px(render({ kind: "running" }, false), ...onBar);
    const dark = px(render({ kind: "running" }, true), ...onBar);
    expect(dark[0]).toBeGreaterThan(light[0] as number);
    expect(hue(px(render({ kind: "running" }, false), 0.82, 0.82))).toBe(
      "green",
    );
  });

  it("draws the attention dot in its own corner, only when asked", () => {
    const corner = [0.86, 0.14] as const;
    expect(px(render({ kind: "running" }, true, false), ...corner)[3]).toBe(0);
    expect(
      px(render({ kind: "running" }, true, true), ...corner)[3],
    ).toBeGreaterThan(200);
    // And the status badge is still readable beside it.
    expect(hue(px(render({ kind: "running" }, true, true), 0.82, 0.82))).toBe(
      "green",
    );
  });

  it("actually animates — every spinner frame differs from the last", () => {
    const frames = Array.from({ length: SPINNER_FRAMES }, (_, frame) =>
      render({ kind: "loading", frame }),
    );
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]?.equals(frames[i - 1] as Buffer)).toBe(false);
    }
  });

  it("leaves no coloured transparent pixels — the premultiplied downsample", () => {
    // Averaging in straight alpha drags colour out of empty pixels and fringes the glyph.
    const buf = render({ kind: "running" });
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] === 0) {
        expect([buf[i], buf[i + 1], buf[i + 2]]).toEqual([0, 0, 0]);
      }
    }
  });

  it("is cheap enough to animate at 8fps", () => {
    const started = Date.now();
    for (let frame = 0; frame < SPINNER_FRAMES; frame++) {
      render({ kind: "loading", frame });
    }
    // The budget is one frame per 120ms tick; this is the whole cycle.
    expect(Date.now() - started).toBeLessThan(SPINNER_FRAMES * 120);
  });
});
