import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LCD_COLORS } from "./lcdScreen";
import {
  type DrawData,
  type SandboxReply,
  widgetRuntime,
} from "./widgetRuntime";

// The demo compressor's screen, run the way the sandbox runs it, against a canvas that records.
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

type Frame = DrawData & { ctx: CanvasRenderingContext2D };
const frame = (
  ctx: CanvasRenderingContext2D,
  input: number[],
  output: number[],
): Frame => ({
  ctx,
  width: 210,
  height: 102,
  scale: 1,
  params: { Threshold: 0.25, Ratio: 0.25, "Output gain": 0 },
  input,
  output,
  color: LCD_COLORS,
  now: 0,
});

// The sandbox's runtime, driven as the page drives it, with a recording canvas for its OffscreenCanvas.
function sandboxed(source: string) {
  const replies: SandboxReply[] = [];
  let current: CanvasRenderingContext2D | null = null;
  const make = (width: number, height: number) =>
    ({
      width,
      height,
      getContext: () => current,
      transferToImageBitmap: () => ({}),
    }) as unknown as OffscreenCanvas;
  const handle = widgetRuntime((r) => replies.push(r), make);
  handle({ t: "script", script: 1, source });
  handle({ t: "describe", req: 1, script: 1 });
  const info = replies.pop()?.info;
  let n = 1;
  // Each call is a fresh screen, so each recorder sees one draw.
  const screen = ({ ctx, ...data }: Frame): void => {
    current = ctx;
    const id = ++n;
    handle({ t: "attach", screen: id });
    handle({
      t: "draw",
      req: id,
      screen: id,
      script: 1,
      id: "screen",
      frame: data,
    });
    const err = replies.pop()?.error;
    if (err) throw new Error(err);
  };
  return { draws: info?.draws ?? [], error: info?.error, screen };
}

describe("the compressor's lcdscreen", () => {
  const { draws: names, error, screen } = sandboxed(SOURCE);
  const draws = { screen };

  it("compiles, and draws `screen`", () => {
    expect(error).toBeUndefined();
    expect(names).toEqual(["screen"]);
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
