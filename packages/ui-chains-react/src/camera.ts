// The graph's camera, as arithmetic: a wheel notch to a zoom goal, a zoom that leaves the point
// under the cursor where it is, the glide that chases the goal, and the little the DRAWING needs
// back from all that. DomChains owns the element and the frame loop; this owns the numbers,
// which is the half worth pinning down — see docs/camera.md.

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

// Zoom per pixel of wheel travel, exponential so a notch is the same RATIO at any zoom.
const ZOOM_RATE = 0.001;
// A line, in pixels, for the browsers that measure a wheel in lines rather than pixels.
const LINE_PX = 16;
// Half of the remaining distance to the goal, covered in this long. Expressed in TIME, so the
// glide takes as long on a 144 Hz screen as on a 60 Hz one instead of arriving 2.4× sooner.
export const ZOOM_HALF_LIFE = 45;

export const clampZoom = (k: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/**
 * One wheel event as a zoom FACTOR, to multiply the goal by.
 *
 * `deltaMode` is why this is not a one-liner: a wheel is measured in pixels almost everywhere,
 * in LINES by Firefox, and in pages in the rare full-page mode. Reading deltaY raw means the
 * same notch zooms by e^-0.1 in Chrome and e^-0.003 in Firefox — which does not read as "slower
 * there", it reads as the wheel being broken.
 */
export function wheelFactor(
  deltaY: number,
  deltaMode: number,
  viewportPx: number,
): number {
  const px =
    deltaMode === 1
      ? deltaY * LINE_PX
      : deltaMode === 2
        ? deltaY * viewportPx
        : deltaY;
  return Math.exp(-px * ZOOM_RATE);
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
