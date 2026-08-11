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
// Half of the remaining distance to the goal, covered in this long. Expressed in TIME, so the
// glide takes as long on a 144 Hz screen as on a 60 Hz one instead of arriving 2.4× sooner.
export const ZOOM_HALF_LIFE = 45;

export const clampZoom = (k: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/**
 * Which gesture a wheel event IS: a zoom, or a pan.
 *
 * On a Mac trackpad — and on a Windows precision touchpad — a PINCH arrives as a wheel event
 * with `ctrlKey` set, synthesised by the browser; two fingers sliding arrive as a plain wheel
 * carrying deltaX and deltaY. There is no other signal, and that is the whole distinction.
 *
 * `metaKey` joins it because Cmd+scroll is the same intention on a Mac mouse.
 *
 * A plain wheel is answered by `isMouseWheel` below: on a SURFACE it slides the view, on a
 * MOUSE it zooms.
 */
export const isZoomWheel = (e: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean => e.ctrlKey || e.metaKey;

/** Below this, a pixel-mode delta is a finger rather than a detent. A notch is ~100 (Chrome). */
const MOUSE_NOTCH_MIN = 40;

/**
 * A mouse WHEEL rather than a surface — two fingers on a trackpad, a touchscreen's inertia.
 *
 * They arrive as the same event and mean opposite things: a wheel is a detent, discrete, and
 * the natural thing for it to do on a graph is ZOOM; a trackpad slide is a hand pushing the
 * view about, and zooming there is what made every attempt to pan a Mac trackpad zoom instead.
 * So the two are told apart rather than legislated over.
 *
 * Three signals, most reliable first:
 *
 * 1. `deltaMode` other than pixels — lines or pages. Only a real wheel is ever reported that
 *    way (Firefox does it for mice), so it settles the question on its own.
 * 2. `wheelDeltaY`, the legacy field Chrome and Safari still carry. A mouse reports it in
 *    multiples of 120 — the detent, from the Windows API that named it — while a trackpad
 *    reports three times its pixel delta, which lands on 120 only by accident. This is what
 *    separates a Mac trackpad from a Mac mouse, and nothing standard does.
 * 3. Failing both (Firefox in pixel mode), the shape of the delta: a notch is integral, has no
 *    horizontal component, and is LARGE, where a finger's is small and often fractional.
 *
 * Wrong in one direction only, by design: an unrecognised device is treated as a surface, so it
 * keeps the behaviour that was there before. A trackpad that zooms is a broken trackpad; a
 * mouse that pans is merely a mouse that does not zoom yet.
 */
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

/**
 * One wheel delta in PIXELS.
 *
 * `deltaMode` is why this exists: a wheel is measured in pixels almost everywhere, in LINES by
 * Firefox, and in pages in the rare full-page mode. Reading a delta raw means the same notch
 * moves 100 units in Chrome and 3 in Firefox — which does not read as "slower there", it reads
 * as the wheel being broken.
 */
export function wheelPixels(
  delta: number,
  deltaMode: number,
  viewportPx: number,
): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * viewportPx;
  return delta;
}

/**
 * One wheel event as a zoom FACTOR, to multiply the goal by.
 *
 * Two steps, and they answer different questions. `wheelPixels` normalises the UNITS, because a
 * browser may report a wheel in lines or in pages; `wheelZoomFactor` then decides the RATE, and
 * a trackpad pinch cannot share a notch's — a notch is one event with a large delta, a pinch is
 * dozens of small ones a second, so the same coefficient makes a pinch crawl.
 *
 * The rate lives in `@studio/ui-chains/zoomGesture` rather than here because that is the half of
 * the graph with tests, and because the arrangement panes settle the same question the same way.
 */
export function wheelFactor(
  deltaY: number,
  deltaMode: number,
  viewportPx: number,
  pinch = false,
): number {
  return wheelZoomFactor(wheelPixels(deltaY, deltaMode, viewportPx), pinch);
}

/**
 * Where a frame's content starts across the pane: centred, or hard LEFT when it spills.
 *
 * Centring a set wider than the pane puts its middle on screen and hides both ends — and for a
 * rank of channel strips the first one is precisely what you look for to know where you are. So
 * a spilling set is left-aligned, inside the same margin the pad allows, and its tail runs off
 * the right where it pans.
 */
export function frameOriginX(
  paneW: number,
  contentW: number,
  pad: number,
  spills: boolean,
): number {
  return spills ? (paneW * (1 - pad)) / 2 : (paneW - contentW) / 2;
}

/**
 * Zoom to `k` keeping the world point under (px, py) under it.
 *
 * Applied on EVERY frame of a glide with that frame's own zoom, not once from the ends — which
 * is what makes the anchor exact for the whole flight rather than only where it started and
 * where it stopped.
 */
export function zoomAbout(cam: Cam, k: number, px: number, py: number): Cam {
  const f = k / cam.k;
  return { k, x: px - (px - cam.x) * f, y: py - (py - cam.y) * f };
}

// The fraction of the remaining distance to cover in `dt` ms. Frame-rate independent by
// construction: two half-lives always halve twice, however the frames fell.
export function approach(dt: number, halfLife = ZOOM_HALF_LIFE): number {
  return 1 - 2 ** (-Math.max(0, dt) / halfLife);
}

/**
 * Everything the drawing takes from the camera — and all of it.
 *
 * The point is what is NOT here: x and y appear nowhere, and above WIDGET_MIN_SCALE none of
 * these three move at all. So panning re-renders nothing, and so does zooming through the range
 * where every node draws its full panel and a render is most expensive.
 */
export interface Lod {
  widgets: boolean;
  labels: boolean;
  boost: number;
}

export function lodFor(k: number): Lod {
  return {
    widgets: k >= WIDGET_MIN_SCALE,
    labels: k >= LABEL_MIN_SCALE,
    // Cables thicken as the camera pulls back so their width holds on screen. Rounded, because
    // a 5% step in a stroke nobody is measuring is not worth re-rendering the graph for.
    boost: Math.round(Math.min(3, Math.max(1, WIDGET_MIN_SCALE / k)) * 20) / 20,
  };
}

export const sameLod = (a: Lod, b: Lod): boolean =>
  a.widgets === b.widgets && a.labels === b.labels && a.boost === b.boost;

// The one place the camera becomes a transform. Written onto the element rather than rendered,
// which is the whole reason a pan costs no React work.
export function applyCam(el: HTMLElement | null, c: Cam): void {
  if (el) el.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.k})`;
}
