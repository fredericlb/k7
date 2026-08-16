// cableCanvas.test.ts — the canvas layer's contracts: it traces EXACTLY the curve the SVG
// `d` string described (the equality that used to be smoothPathXY's byte-identity test), the
// wobble leaves both endpoints untouched, and a frame applies the camera and strokes
// shadow-then-cable at the widths the stylesheet used.

import { describe, expect, it } from "vitest";
import {
  AUTO_ARROW,
  AUTO_DASH,
  AUTO_SHADOW_W,
  AUTO_W,
  CABLE_W,
  type CableCtx,
  drawCables,
  flattenInto,
  newScratch,
  SHADOW_COLOR,
  SHADOW_W,
  swayInto,
  tracePolyline,
  WOBBLE_AMP,
  WOBBLE_WAVELENGTH,
  wobbleInto,
} from "./cableCanvas";
import { buildCableGeom, type CableGeom, smoothPath } from "./cables";
import type { Pt } from "./graph";

const line = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];
const bend = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

type Call = [string, ...number[]];

// A context that records instead of drawing, plus the state a frame sets on it.
function recorder(): CableCtx & {
  calls: Call[];
  strokes: [string, number][];
  fills: string[];
  dashes: (readonly number[])[];
} {
  const calls: Call[] = [];
  const strokes: [string, number][] = [];
  const fills: string[] = [];
  const dashes: (readonly number[])[] = [];
  return {
    calls,
    strokes,
    fills,
    dashes,
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "",
    lineJoin: "",
    clearRect: (...a) => void calls.push(["clearRect", ...a]),
    setTransform: (...a) => void calls.push(["setTransform", ...a]),
    beginPath: () => void calls.push(["beginPath"]),
    moveTo: (...a) => void calls.push(["moveTo", ...a]),
    lineTo: (...a) => void calls.push(["lineTo", ...a]),
    bezierCurveTo: (...a) => void calls.push(["bezierCurveTo", ...a]),
    closePath: () => void calls.push(["closePath"]),
    setLineDash: (segs) => void dashes.push(segs),
    stroke() {
      calls.push(["stroke"]);
      strokes.push([String(this.strokeStyle), this.lineWidth]);
    },
    fill() {
      calls.push(["fill"]);
      fills.push(String(this.fillStyle));
    },
  };
}

/**
 * The path calls an SVG `d` string stands for.
 *
 * Reading the reference back out of `smoothPath` is deliberate: it is the same authority the
 * old byte-identity test used, and a double survives `toString`/`parseFloat` exactly, so
 * comparing against it is as strict as comparing the strings was.
 */
function callsOf(d: string): Call[] {
  const tok = d.split(/[\s,]+/).filter(Boolean);
  const out: Call[] = [];
  const args = (n: number, at: number) =>
    tok.slice(at, at + n).map((s) => Number.parseFloat(s));
  for (let i = 0; i < tok.length; ) {
    const op = tok[i];
    const n = op === "C" ? 6 : 2;
    out.push([
      op === "M" ? "moveTo" : op === "L" ? "lineTo" : "bezierCurveTo",
      ...args(n, i + 1),
    ]);
    i += n + 1;
  }
  return out;
}

const pathCalls = (pts: Pt[]): Call[] => {
  const ctx = recorder();
  const s = newScratch();
  tracePolyline(ctx, s.buf, flattenInto(s, pts));
  return ctx.calls;
};

describe("tracePolyline", () => {
  it("traces exactly what smoothPath drew", () => {
    expect(pathCalls(line)).toEqual(callsOf(smoothPath(line)));
    expect(pathCalls(bend)).toEqual(callsOf(smoothPath(bend)));
  });

  it("draws nothing below two points", () => {
    expect(pathCalls([])).toEqual([]);
    expect(pathCalls([{ x: 1, y: 1 }])).toEqual([]);
  });

  it("agrees on the wobbled, irrational coordinates it exists for", () => {
    // The real input: a resampled cable pushed off its normals, so nothing lands on a round number.
    const g = buildCableGeom([
      { x: 0, y: 0 },
      { x: 137, y: 41 },
      { x: 210, y: 190 },
      { x: 33, y: 260 },
    ]);
    const s = newScratch();
    for (const phase of [0, 0.7, Math.PI, 4.2]) {
      const n = wobbleInto(s, g, phase);
      const ctx = recorder();
      tracePolyline(ctx, s.buf, n);
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++)
        pts.push({ x: s.buf[i * 2], y: s.buf[i * 2 + 1] });
      expect(ctx.calls).toEqual(callsOf(smoothPath(pts)));
    }
  });

  it("reads only `count` points, so one buffer serves cables of every length", () => {
    const s = newScratch();
    flattenInto(s, bend.concat([{ x: 999, y: 999 }]));
    const ctx = recorder();
    tracePolyline(ctx, s.buf, bend.length);
    expect(ctx.calls).toEqual(callsOf(smoothPath(bend)));
  });
});

describe("wobbleInto", () => {
  const g = buildCableGeom(bend);

  it("leaves both endpoints exactly where the still cable's are", () => {
    // sin(pi*u) is 0 at u=0 and u=1 — this is why the label and the arrowhead never move.
    const s = newScratch();
    for (const phase of [0, 1.3, Math.PI]) {
      const n = wobbleInto(s, g, phase);
      const first = g.samples[0];
      const last = g.samples[n - 1];
      expect(s.buf[0]).toBeCloseTo(first.x, 12);
      expect(s.buf[1]).toBeCloseTo(first.y, 12);
      expect(s.buf[(n - 1) * 2]).toBeCloseTo(last.x, 12);
      expect(s.buf[(n - 1) * 2 + 1]).toBeCloseTo(last.y, 12);
    }
  });

  it("displaces the middle by no more than the amplitude", () => {
    const s = newScratch();
    const n = wobbleInto(s, g, 0.4);
    for (let i = 0; i < n; i++) {
      const p = g.samples[i];
      expect(
        Math.hypot(s.buf[i * 2] - p.x, s.buf[i * 2 + 1] - p.y),
      ).toBeLessThanOrEqual(WOBBLE_AMP + 1e-9);
    }
  });

  it("grows the scratch for a cable longer than it, and reuses it otherwise", () => {
    const s = newScratch();
    const before = s.buf;
    wobbleInto(s, g, 0);
    expect(s.buf).toBe(before); // the common case allocates nothing
    const long: CableGeom = {
      base: g.base,
      len: g.len,
      samples: Array.from({ length: before.length }, () => g.samples[0]),
    };
    wobbleInto(s, long, 0);
    expect(s.buf.length).toBeGreaterThanOrEqual(before.length * 2);
  });

  it("a sway rides the same pinned-ends envelope — a swinging cable stays plugged in", () => {
    const s = newScratch();
    const n = wobbleInto(s, g, 0.7, WOBBLE_AMP, WOBBLE_WAVELENGTH, 18, -9);
    expect(s.buf[0]).toBeCloseTo(g.samples[0].x, 12);
    expect(s.buf[1]).toBeCloseTo(g.samples[0].y, 12);
    expect(s.buf[(n - 1) * 2]).toBeCloseTo(g.samples[n - 1].x, 12);
    expect(s.buf[(n - 1) * 2 + 1]).toBeCloseTo(g.samples[n - 1].y, 12);
  });
});

describe("swayInto", () => {
  it("pins the endpoints and pushes the middle by the offset", () => {
    const base: Pt[] = [
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ];
    const s = newScratch();
    const n = swayInto(s, base, 10, 20);
    expect(n).toBe(3);
    // Close-to, not equal: sin(pi) is ~1e-16 in floats, invisible at any zoom.
    expect(s.buf[0]).toBeCloseTo(0, 12);
    expect(s.buf[1]).toBeCloseTo(0, 12);
    expect(s.buf[4]).toBeCloseTo(100, 12);
    expect(s.buf[5]).toBeCloseTo(0, 12);
    // The middle carries the full offset: sin(pi/2) = 1.
    expect(s.buf[2]).toBeCloseTo(60, 12);
    expect(s.buf[3]).toBeCloseTo(30, 12);
  });
});

describe("drawCables", () => {
  const g = buildCableGeom(bend);
  const frame = (over: Partial<Parameters<typeof drawCables>[1]> = {}) => ({
    width: 800,
    height: 600,
    cam: { x: 10, y: -20, k: 2 },
    dpr: 3,
    cables: [{ geom: g, color: "#d98b45", live: false }],
    phase: 0,
    boost: 1,
    ...over,
  });

  it("clears in device space, then puts the camera on the context", () => {
    const ctx = recorder();
    drawCables(ctx, frame(), newScratch());
    expect(ctx.calls[0]).toEqual(["setTransform", 1, 0, 0, 1, 0, 0]);
    expect(ctx.calls[1]).toEqual(["clearRect", 0, 0, 800, 600]);
    // dpr * k for the scale, dpr * pan for the translate — the world coordinates below are then
    // the same numbers the SVG carried inside `.dgx-world`.
    expect(ctx.calls[2]).toEqual(["setTransform", 6, 0, 0, 6, 30, -60]);
  });

  it("strokes shadow then cable, at the widths the stylesheet carried", () => {
    const ctx = recorder();
    drawCables(ctx, frame({ boost: 2 }), newScratch());
    expect(ctx.strokes).toEqual([
      [SHADOW_COLOR, SHADOW_W * 2],
      ["#d98b45", CABLE_W * 2],
    ]);
  });

  it("wobbles a live cable and leaves a still one on its base points", () => {
    const rest = recorder();
    drawCables(rest, frame(), newScratch());
    const moving = recorder();
    drawCables(
      moving,
      frame({
        cables: [{ geom: g, color: "#d98b45", live: true }],
        phase: 1.1,
      }),
      newScratch(),
    );
    // At rest it is the base polyline verbatim; live it is the denser resampling, displaced.
    const bez = (c: Call[]) => c.filter((x) => x[0] === "bezierCurveTo").length;
    expect(bez(rest.calls)).toBe(g.base.length - 1);
    expect(bez(moving.calls)).toBe(g.samples.length - 1);
  });

  it("skips a cable that has no line to draw", () => {
    const stub: CableGeom = { base: [{ x: 1, y: 1 }], samples: [], len: 0 };
    const ctx = recorder();
    drawCables(
      ctx,
      frame({ cables: [{ geom: stub, color: "#fff", live: false }] }),
      newScratch(),
    );
    expect(ctx.strokes).toEqual([]);
  });

  it("an automation cable wears its dress: solid shadow, dashed stroke, filled arrowhead", () => {
    const ctx = recorder();
    drawCables(
      ctx,
      frame({
        cables: [
          {
            geom: g,
            color: "#a889b5",
            live: false,
            width: AUTO_W,
            shadowWidth: AUTO_SHADOW_W,
            dash: AUTO_DASH,
            arrowSize: AUTO_ARROW,
          },
        ],
      }),
      newScratch(),
    );
    expect(ctx.strokes).toEqual([
      [SHADOW_COLOR, AUTO_SHADOW_W],
      ["#a889b5", AUTO_W],
    ]);
    // Solid for the shadow, the dash for the cable, solid again for the head.
    expect(ctx.dashes).toEqual([[], AUTO_DASH, []]);
    expect(ctx.fills).toEqual(["#a889b5"]);
    // The head is a closed triangle whose TIP is the cable's own last drawn point.
    const closeAt = ctx.calls.findIndex((c) => c[0] === "closePath");
    expect(closeAt).toBeGreaterThan(-1);
    const tip = ctx.calls
      .slice(0, closeAt)
      .reverse()
      .find((c) => c[0] === "moveTo");
    const last = g.base[g.base.length - 1];
    expect(tip?.[1]).toBeCloseTo(last.x, 12);
    expect(tip?.[2]).toBeCloseTo(last.y, 12);
  });
});
