import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileWidgetsScript, LCD_COLORS, type LcdFrame } from "./lcdScreen";

// The demo compressor's screen, run the way the widget runs it, against a canvas that records.
const SOURCE = readFileSync(
  join(__dirname, "../../../demos/_modules/audio/compressor/widgets.js"),
  "utf8",
);

function recorder() {
  const texts: string[] = [];
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] =
    [];
  let fill = "";
  const ctx = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === "fillText") return (s: string) => texts.push(s);
        if (key === "fillRect")
          return (x: number, y: number, w: number, h: number) =>
            rects.push({ x, y, w, h, fill });
        if (key === "measureText")
          return (s: string) => ({ width: s.length * 5 });
        return () => {};
      },
      set(_t, key, v) {
        if (key === "fillStyle") fill = v;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, rects };
}

const frame = (
  ctx: CanvasRenderingContext2D,
  input: number[],
  output: number[],
): LcdFrame => ({
  ctx,
  width: 210,
  height: 102,
  params: { Threshold: 0.25, Ratio: 0.25, "Output gain": 0 },
  input,
  output,
  state: {},
  color: LCD_COLORS,
  now: 0,
});

describe("the compressor's lcdscreen", () => {
  const { draws, error } = compileWidgetsScript(SOURCE);

  it("compiles, and draws `screen`", () => {
    expect(error).toBeUndefined();
    expect(Object.keys(draws)).toEqual(["screen"]);
  });

  it("reads the gain reduction off the two taps", () => {
    // A 0.8 peak through T=0.25 (-12 dB) at ratio 0.25 (4:1): out = 0.25 + 0.55 * 0.25 = 0.3875.
    const input = Array(400).fill(0.8);
    const output = Array(400).fill(0.3875);
    const r = recorder();
    draws.screen(frame(r.ctx, input, output));
    const gr = r.texts.find((t) => t.startsWith("GR"));
    expect(gr).toBe(`GR ${(20 * Math.log10(0.3875 / 0.8)).toFixed(1)}dB`);
    expect(r.texts).toContain("T -12.0dB  4.0:1");
    // …and lights the band it removed.
    expect(r.rects.some((x) => x.fill === LCD_COLORS.glow && x.h > 0)).toBe(
      true,
    );
  });

  it("says so when nothing is playing, and still draws the curve", () => {
    const r = recorder();
    draws.screen(frame(r.ctx, [], []));
    expect(r.texts).toContain("GR --");
    expect(r.texts).toContain("no signal");
  });

  it("lights nothing under the threshold", () => {
    const quiet = Array(300).fill(0.1);
    const r = recorder();
    draws.screen(frame(r.ctx, quiet, quiet));
    expect(r.rects.some((x) => x.fill === LCD_COLORS.glow)).toBe(false);
    expect(r.texts).toContain("GR 0.0dB");
  });
});
