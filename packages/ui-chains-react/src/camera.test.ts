// The camera's arithmetic: a notch means the same thing in every browser, a zoom holds the
// point under the cursor, the glide is measured in time, and the drawing hears about as little
// of all that as possible.

import { describe, expect, it } from "vitest";
import {
  applyCam,
  approach,
  type Cam,
  clampZoom,
  FRAME_FILL,
  FRAME_MAX_ZOOM,
  flyStep,
  frameBox,
  frameOriginX,
  lodFor,
  MAX_ZOOM,
  MIN_ZOOM,
  sameLod,
  wheelFactor,
  wheelPixels,
  ZOOM_HALF_LIFE,
  zoomAbout,
} from "./camera";

describe("wheelPixels", () => {
  it("reads a delta the same however the browser measured it", () => {
    // Chrome sends pixels, Firefox sends the same gesture as lines; a page is the viewport.
    expect(wheelPixels(100, 0, 800)).toBe(100);
    expect(wheelPixels(100 / 16, 1, 800)).toBeCloseTo(100, 10);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });

  it("keeps the sign, because it is a direction and not an amount", () => {
    expect(wheelPixels(-3, 1, 800)).toBe(-48);
  });
});

describe("wheelFactor", () => {
  it("reads a notch the same however the browser measured it", () => {
    // Apart by more than a hair, the wheel reads as broken in one of the two browsers.
    const px = wheelFactor(100, 0, 800);
    const lines = wheelFactor(100 / 16, 1, 800);
    expect(lines).toBeCloseTo(px, 6);
  });

  it("scales a page-mode delta by the viewport it means", () => {
    expect(wheelFactor(1, 2, 800)).toBeCloseTo(wheelFactor(800, 0, 800), 10);
  });

  it("is a RATIO, so a notch does the same thing at any zoom", () => {
    // Zooming in then out by the same notch lands back where it started, wherever it started.
    const inF = wheelFactor(-100, 0, 800);
    const outF = wheelFactor(100, 0, 800);
    expect(inF * outF).toBeCloseTo(1, 10);
    expect(inF).toBeGreaterThan(1);
  });
});

describe("zoomAbout", () => {
  it("leaves the world point under the cursor exactly where it was", () => {
    const cam: Cam = { x: -120, y: 40, k: 0.8 };
    const px = 300;
    const py = 210;
    // The world coordinate under the pointer, before and after.
    const before = { x: (px - cam.x) / cam.k, y: (py - cam.y) / cam.k };
    const next = zoomAbout(cam, 1.6, px, py);
    expect((px - next.x) / next.k).toBeCloseTo(before.x, 10);
    expect((py - next.y) / next.k).toBeCloseTo(before.y, 10);
  });

  it("holds it for EVERY step of a glide, not just the ends", () => {
    // Applied frame by frame with each frame's own zoom, so the anchor never drifts and snaps back.
    let cam: Cam = { x: 15, y: -60, k: 0.5 };
    const px = 420;
    const py = 90;
    const before = { x: (px - cam.x) / cam.k, y: (py - cam.y) / cam.k };
    for (const k of [0.62, 0.78, 0.94, 1.1, 1.25]) {
      cam = zoomAbout(cam, k, px, py);
      expect((px - cam.x) / cam.k).toBeCloseTo(before.x, 10);
      expect((py - cam.y) / cam.k).toBeCloseTo(before.y, 10);
    }
  });
});

describe("approach", () => {
  it("covers half the distance in one half-life", () => {
    expect(approach(ZOOM_HALF_LIFE)).toBeCloseTo(0.5, 10);
  });

  it("does not care how the frames fell", () => {
    // Two 8ms frames on a 120Hz screen leave exactly what one 16ms frame does at 60.
    const one = approach(16);
    const two = 1 - (1 - approach(8)) * (1 - approach(8));
    expect(two).toBeCloseTo(one, 10);
  });

  it("never overshoots, whatever dt a backgrounded tab hands back", () => {
    expect(approach(100000)).toBeLessThanOrEqual(1);
    expect(approach(-5)).toBe(0);
  });
});

describe("clampZoom", () => {
  it("holds the range the renderer was built for", () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(1.3)).toBe(1.3);
  });
});

describe("lodFor", () => {
  it("says nothing changes through the range where a render costs most", () => {
    // Above WIDGET_MIN_SCALE none of the three moves, so zooming commits no React state at all.
    expect(sameLod(lodFor(0.7), lodFor(3.9))).toBe(true);
  });

  it("drops the widgets, then the labels, as the camera pulls back", () => {
    expect(lodFor(0.7).widgets).toBe(true);
    expect(lodFor(0.5).widgets).toBe(false);
    expect(lodFor(0.5).labels).toBe(true);
    expect(lodFor(0.3).labels).toBe(false);
  });

  it("thickens the cables below that, in steps too coarse to see", () => {
    expect(lodFor(1).boost).toBe(1);
    expect(lodFor(0.3).boost).toBe(2);
    // A hair of zoom is not a new value — that is what keeps it off the render path.
    expect(lodFor(0.3).boost).toBe(lodFor(0.301).boost);
  });

  it("caps the boost, so the far view is cables and not a mesh", () => {
    expect(lodFor(0.01).boost).toBe(3);
  });
});

describe("applyCam", () => {
  it("writes the transform and the zoom, and tolerates having no element yet", () => {
    const vars = new Map<string, string>();
    const style = {
      getPropertyValue: (k: string) => vars.get(k) ?? "",
      setProperty: (k: string, v: string) => vars.set(k, v),
    } as unknown as CSSStyleDeclaration;
    const el = { style } as HTMLElement;
    applyCam(el, { x: 12.5, y: -3, k: 0.75 });
    expect(el.style.transform).toBe("translate(12.5px,-3px) scale(0.75)");
    // The zoom, for the CSS that caps header text on screen (chainsCss.ts).
    expect(vars.get("--dgx-k")).toBe("0.75");
    expect(() => applyCam(null, { x: 0, y: 0, k: 1 })).not.toThrow();
  });
});

describe("frameOriginX", () => {
  // The mixer row is the case this exists for: a rank of strips wider than the pane.
  const PAD = 0.9;

  it("centres a frame that fits across", () => {
    expect(frameOriginX(1000, 400, PAD, false)).toBe(300);
  });

  it("puts a spilling frame hard left, inside the pad's margin", () => {
    expect(frameOriginX(1000, 4000, PAD, true)).toBeCloseTo(50);
  });

  it("would have hidden the first card had it centred", () => {
    // Same numbers, centred: the content starts off the left edge — the bug this rule exists for.
    expect(frameOriginX(1000, 4000, PAD, false)).toBeLessThan(0);
    expect(frameOriginX(1000, 4000, PAD, true)).toBeGreaterThan(0);
  });
});

describe("frameBox", () => {
  // Where a world point lands on screen under a camera.
  const at = (c: Cam, x: number, y: number) => ({
    x: x * c.k + c.x,
    y: y * c.k + c.y,
  });

  it("puts the box's centre at the pane's centre", () => {
    const c = frameBox({ x: 500, y: -200, w: 180, h: 120 }, 1000, 600);
    const mid = at(c, 590, -140);
    expect(mid.x).toBeCloseTo(500);
    expect(mid.y).toBeCloseTo(300);
  });

  it("fills the pane by FRAME_FILL on the tighter axis", () => {
    const c = frameBox({ x: 0, y: 0, w: 600, h: 100 }, 1000, 600);
    expect(c.k).toBeCloseTo((1000 * FRAME_FILL) / 600);
  });

  it("never zooms a small card past FRAME_MAX_ZOOM, where a card reads fine and the graph around it is gone", () => {
    expect(frameBox({ x: 0, y: 0, w: 20, h: 20 }, 1000, 600).k).toBe(
      FRAME_MAX_ZOOM,
    );
  });
});

describe("flyStep", () => {
  const from: Cam = { x: 0, y: 0, k: 0.5 };
  const to: Cam = { x: -900, y: -400, k: 2 };

  it("is the start at f = 0 and lands exactly at f = 1", () => {
    const a = flyStep(from, to, 0, 1000, 600);
    expect(a.k).toBeCloseTo(from.k);
    expect(a.x).toBeCloseTo(from.x);
    expect(flyStep(from, to, 1, 1000, 600)).toEqual(to);
  });

  it("arrives by repeated steps, as the frame loop runs it", () => {
    let c = from;
    for (let i = 0; i < 200 && (c.x !== to.x || c.k !== to.k); i++)
      c = flyStep(c, to, 0.25, 1000, 600);
    expect(c).toEqual(to);
  });
});
