// The camera's arithmetic: a notch means the same thing in every browser, a zoom holds the
// point under the cursor, the glide is measured in time, and the drawing hears about as little
// of all that as possible.

import { describe, expect, it } from "vitest";
import {
  applyCam,
  approach,
  type Cam,
  clampZoom,
  isZoomWheel,
  lodFor,
  MAX_ZOOM,
  MIN_ZOOM,
  sameLod,
  wheelFactor,
  wheelPixels,
  ZOOM_HALF_LIFE,
  zoomAbout,
} from "./camera";

describe("isZoomWheel", () => {
  it("calls a PINCH a zoom — that is how a trackpad sends one", () => {
    // The browser synthesises ctrlKey for a pinch on a Mac trackpad and on a Windows precision
    // touchpad. It is the only signal there is.
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
  });

  it("calls a plain wheel a PAN, which is the whole change", () => {
    // Two fingers sliding arrive exactly like a mouse wheel. Zooming on that is what made every
    // attempt to pan a Mac trackpad zoom instead — so the plain wheel gives up zoom.
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

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
    // Chrome sends pixels, Firefox sends the same gesture as lines. Within a hair of each other
    // is the whole point: apart, the wheel reads as broken in one of them.
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
    // Applied frame by frame with each frame's own zoom — which is why the anchor is exact all
    // the way through instead of drifting and snapping back at the end.
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
    // Above WIDGET_MIN_SCALE every node draws its whole panel — and zooming there moves none of
    // the three, so it commits no React state at all.
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
  it("writes the transform, and tolerates having no element yet", () => {
    const el = { style: {} as CSSStyleDeclaration } as HTMLElement;
    applyCam(el, { x: 12.5, y: -3, k: 0.75 });
    expect(el.style.transform).toBe("translate(12.5px,-3px) scale(0.75)");
    expect(() => applyCam(null, { x: 0, y: 0, k: 1 })).not.toThrow();
  });
});
