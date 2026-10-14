// A shot's motion: the matrix must move a quad exactly as the same motion computed in PIXELS
// would — a sign wrong anywhere turns a clockwise turn anticlockwise or skews a non-square frame.

import { describe, expect, it } from "vitest";
import { rectToClip } from "./geometry";
import { motionAffine, motionAt, scissorBox, slotMotions } from "./motion";
import type { SceneClip } from "./scene";

const FW = 1280;
const FH = 720;
const RECT = { x: 100, y: 50, w: 400, h: 300 };

// A clip-space point through the column-major affine, then back to viewport px.
function apply(a: Float32Array, x: number, y: number): [number, number] {
  const cx = a[0] * x + a[3] * y + a[6];
  const cy = a[1] * x + a[4] * y + a[7];
  return [((cx + 1) * FW) / 2, ((1 - cy) * FH) / 2];
}

// The same motion done directly in px: about the rect's centre, y down, so a positive angle turns clockwise.
function expected(
  px: number,
  py: number,
  m: { x: number; y: number; scale: number; rotate: number },
) {
  const c = [RECT.x + RECT.w / 2, RECT.y + RECT.h / 2];
  const r = (m.rotate * Math.PI) / 180;
  const dx = px - c[0];
  const dy = py - c[1];
  return [
    c[0] + m.x + m.scale * (Math.cos(r) * dx - Math.sin(r) * dy),
    c[1] + m.y + m.scale * (Math.sin(r) * dx + Math.cos(r) * dy),
  ];
}

describe("motionAffine", () => {
  const [x0, y0, x1, y1] = rectToClip(RECT.x, RECT.y, RECT.w, RECT.h, FW, FH);
  const corners: [number, number, number, number][] = [
    [x0, y0, RECT.x, RECT.y + RECT.h],
    [x1, y0, RECT.x + RECT.w, RECT.y + RECT.h],
    [x0, y1, RECT.x, RECT.y],
    [x1, y1, RECT.x + RECT.w, RECT.y],
  ];

  for (const m of [
    { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 },
    { x: 40, y: -25, scale: 1, rotate: 0, opacity: 1 },
    { x: 0, y: 0, scale: 1.5, rotate: 0, opacity: 1 },
    { x: 10, y: 20, scale: 0.8, rotate: 30, opacity: 1 },
    { x: 0, y: 0, scale: 1, rotate: -90, opacity: 1 },
  ])
    it(`moves every corner as the px arithmetic does — ${JSON.stringify(m)}`, () => {
      const a = motionAffine(RECT, m, FW, FH);
      for (const [cx, cy, px, py] of corners) {
        const [gx, gy] = apply(a, cx, cy);
        const [ex, ey] = expected(px, py, m);
        expect(gx).toBeCloseTo(ex, 3);
        expect(gy).toBeCloseTo(ey, 3);
      }
    });
});

describe("motionAt", () => {
  const clip = (animate?: SceneClip["animate"]): SceneClip => ({
    id: "a",
    src: "a.mp4",
    start: 10,
    length: 4,
    sourceFrom: 0,
    ...(animate ? { animate } : {}),
  });

  it("reads time from the shot's own start", () => {
    const m = motionAt(
      clip({
        x: [
          { t: 0, v: 0, ease: "linear" },
          { t: 2, v: 100, ease: "linear" },
        ],
      }),
      11,
    );
    expect(m?.x).toBe(50);
  });

  it("answers null at rest, which is what keeps an unanimated shot free", () => {
    expect(motionAt(clip(), 11)).toBeNull();
    expect(
      motionAt(clip({ scale: [{ t: 0, v: 1, ease: "linear" }] }), 11),
    ).toBeNull();
  });

  it("puts a cut's only picture in slot 0, and a blend's two in their own slots", () => {
    const a = clip({ opacity: [{ t: 0, v: 0.5, ease: "linear" }] });
    const act = (c: SceneClip) => ({
      clip: c,
      sourceTime: 0,
      end: 14,
      index: 0,
    });
    expect(
      slotMotions({ from: null, to: act(a), blend: null }, 11)[0]?.opacity,
    ).toBe(0.5);
    const both = slotMotions(
      {
        from: act(clip()),
        to: act(a),
        blend: { name: "dissolve", progress: 0.5 },
      },
      11,
    );
    expect(both[0]).toBeNull();
    expect(both[1]?.opacity).toBe(0.5);
  });
});

describe("scissorBox", () => {
  it("flips the rect into GL's bottom-left pixel space", () => {
    expect(scissorBox(RECT, FH)).toEqual([100, 370, 400, 300]);
  });
});
