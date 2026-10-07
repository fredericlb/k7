// The graph's camera, as arithmetic: a wheel notch to a zoom goal, a zoom that leaves the point
// under the cursor where it is, the glide that chases the goal, and the little the DRAWING needs
// back from all that. DomChains owns the element and the frame loop; this owns the numbers,
// which is the half worth pinning down — see docs/camera.md.

import { wheelZoomFactor } from "@studio/ui-chains/zoomGesture";

export interface Cam {
  x: number;
  y: number;
  k: number;
}

// Carried over verbatim from the WebGL renderer, so the feel is identical.
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
export const WIDGET_MIN_SCALE = 0.6; // below this the widget grid is dropped (unreadable anyway)
export const LABEL_MIN_SCALE = 0.4; // …and below this the text goes too

// A line, in pixels, for the browsers that measure a wheel in lines rather than pixels.
const LINE_PX = 16;
// Half the remaining distance to the goal, covered in this long — in TIME, so a 144 Hz screen glides no sooner.
export const ZOOM_HALF_LIFE = 45;

export const clampZoom = (k: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Which gesture a wheel event IS: a pinch arrives with `ctrlKey` set, anything else pans — docs/camera.md. */
export const isZoomWheel = (e: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean => e.ctrlKey || e.metaKey;

/** Below this, a pixel-mode delta is a finger rather than a detent. A notch is ~100 (Chrome). */
const MOUSE_NOTCH_MIN = 40;

/** A mouse WHEEL rather than a surface, from three signals in order of reliability — docs/camera.md. */
export function isMouseWheel(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  wheelDeltaY?: number;
}): boolean {
  if (e.deltaMode !== 0) return true;
  const legacy = e.wheelDeltaY;
  if (typeof legacy === "number" && legacy !== 0)
    return Math.abs(legacy) % 120 === 0;
  if (e.deltaX !== 0) return false;
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= MOUSE_NOTCH_MIN;
}

/** One wheel delta in PIXELS: `deltaMode` may report lines or pages, a 30× difference — docs/camera.md. */
export function wheelPixels(
  delta: number,
  deltaMode: number,
  viewportPx: number,
): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * viewportPx;
  return delta;
}

/** One wheel event as a zoom FACTOR: normalise the units here, decide the rate elsewhere — docs/camera.md. */
export function wheelFactor(
  deltaY: number,
  deltaMode: number,
  viewportPx: number,
  pinch = false,
): number {
  return wheelZoomFactor(wheelPixels(deltaY, deltaMode, viewportPx), pinch);
}

/** Where a frame's content starts across the pane: centred, or hard LEFT when it spills — docs/camera.md. */
export function frameOriginX(
  paneW: number,
  contentW: number,
  pad: number,
  spills: boolean,
): number {
  return spills ? (paneW * (1 - pad)) / 2 : (paneW - contentW) / 2;
}

/** Zoom to `k` keeping the world point under (px, py) under it, on EVERY frame of a glide — docs/camera.md. */
export function zoomAbout(cam: Cam, k: number, px: number, py: number): Cam {
  const f = k / cam.k;
  return { k, x: px - (px - cam.x) * f, y: py - (py - cam.y) * f };
}

// The fraction of the remaining distance to cover in `dt` ms — two half-lives always halve twice.
export function approach(dt: number, halfLife = ZOOM_HALF_LIFE): number {
  return 1 - 2 ** (-Math.max(0, dt) / halfLife);
}

/** Everything the drawing takes from the camera, and all of it — x and y appear nowhere, docs/camera.md. */
export interface Lod {
  widgets: boolean;
  labels: boolean;
  boost: number;
}

export function lodFor(k: number): Lod {
  return {
    widgets: k >= WIDGET_MIN_SCALE,
    labels: k >= LABEL_MIN_SCALE,
    // Cables thicken as the camera pulls back so their width holds on screen, rounded to 5% steps.
    boost: Math.round(Math.min(3, Math.max(1, WIDGET_MIN_SCALE / k)) * 20) / 20,
  };
}

export const sameLod = (a: Lod, b: Lod): boolean =>
  a.widgets === b.widgets && a.labels === b.labels && a.boost === b.boost;

// The one place the camera becomes a transform, written onto the element rather than rendered.
export function applyCam(el: HTMLElement | null, c: Cam): void {
  if (!el) return;
  el.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.k})`;
  // The zoom for CSS too, which caps what it draws on SCREEN (chainsCss.ts); set only when it moves, a pan costing no restyle.
  const k = String(c.k);
  if (el.style.getPropertyValue("--dgx-k") !== k)
    el.style.setProperty("--dgx-k", k);
}

/** How much of the pane a node framed by a double-click fills, and the zoom it never goes past. */
export const FRAME_FILL = 0.7;
export const FRAME_MAX_ZOOM = 2;

/** The camera that centres the box (world units) in a `w` × `h` pane, zoomed to fill it — docs/camera.md. */
export function frameBox(
  box: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
): Cam {
  const k = clampZoom(
    Math.min(
      FRAME_MAX_ZOOM,
      (w * FRAME_FILL) / Math.max(1, box.w),
      (h * FRAME_FILL) / Math.max(1, box.h),
    ),
  );
  return {
    k,
    x: w / 2 - (box.x + box.w / 2) * k,
    y: h / 2 - (box.y + box.h / 2) * k,
  };
}

/** One frame of a FLIGHT to `to`: the zoom and the world point at the pane's centre both close in by `f`. */
export function flyStep(
  from: Cam,
  to: Cam,
  f: number,
  w: number,
  h: number,
): Cam {
  // The CENTRE moves in world units rather than x and y in screen px, so the target stays in view throughout.
  const cx = (w / 2 - from.x) / from.k;
  const cy = (h / 2 - from.y) / from.k;
  const tx = (w / 2 - to.x) / to.k;
  const ty = (h / 2 - to.y) / to.k;
  const k = from.k + (to.k - from.k) * f;
  const x = cx + (tx - cx) * f;
  const y = cy + (ty - cy) * f;
  const next = { k, x: w / 2 - x * k, y: h / 2 - y * k };
  // Within a thousandth of the zoom and half a pixel of the place, land on it — an exponential never arrives.
  const landed =
    Math.abs(to.k - k) <= k * 1e-3 &&
    Math.abs(to.x - next.x) < 0.5 &&
    Math.abs(to.y - next.y) < 0.5;
  return landed ? { ...to } : next;
}
