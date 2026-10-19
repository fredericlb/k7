// viewportRect.ts — picking a layer in the frame and dragging its rect: which layer a click
// lands on, which of the eight grips it grabbed, and what each grip does to x/y/w/h. Pure px
// arithmetic, kept out of the component because it is the half that ends up in a file and the
// half a test can reach — a GL context draws none of it. See docs/picture.md.

/** A layer's rect in VIEWPORT px, which is exactly what `video_tracks/<id>.k7x` states. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a press grabbed: the body (a move) or one of the eight edges and corners (a resize). */
export type Grip = "body" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** A layer as the picking cares about it — hidden means `mute:`, and a hidden layer is not there to click. */
export interface PickLayer {
  id: string;
  rect: Rect;
  hidden: boolean;
}

/** Never let a resize invert or vanish a layer: below this it is unclickable and unrecoverable. */
export const MIN_SIDE = 16;

/** How far outside an edge still counts as grabbing it, in VIEWPORT px at scale 1 — the caller scales it. */
export const GRIP_TOL = 8;

const inside = (r: Rect, x: number, y: number, pad = 0): boolean =>
  x >= r.x - pad &&
  x <= r.x + r.w + pad &&
  y >= r.y - pad &&
  y <= r.y + r.h + pad;

/** Every layer under the point, FRONT first — `layers` is bottom-first, so the last one drawn leads. */
export function layersAt(
  layers: readonly PickLayer[],
  x: number,
  y: number,
): string[] {
  const out: string[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.hidden && inside(l.rect, x, y)) out.push(l.id);
  }
  return out;
}

/** The layer a plain click lands on: the front one, which is the one you can see. */
export const hitLayer = (
  layers: readonly PickLayer[],
  x: number,
  y: number,
): string | null => layersAt(layers, x, y)[0] ?? null;

/** …and the NEXT one down, which is how a layer hidden behind a full-frame one is ever reached. */
export function layerBelow(
  layers: readonly PickLayer[],
  x: number,
  y: number,
  current: string | null,
): string | null {
  const stack = layersAt(layers, x, y);
  if (!stack.length) return null;
  const at = current ? stack.indexOf(current) : -1;
  // Wraps, so cycling comes back to the front rather than stopping at the bottom with nothing to say.
  return stack[(at + 1) % stack.length];
}

/** Which grip a press on the SELECTED layer took, or null when it missed the rect and its border. */
export function gripAt(
  r: Rect,
  x: number,
  y: number,
  tol = GRIP_TOL,
): Grip | null {
  if (!inside(r, x, y, tol)) return null;
  const w = Math.abs(x - r.x) <= tol;
  const e = Math.abs(x - (r.x + r.w)) <= tol;
  const n = Math.abs(y - r.y) <= tol;
  const s = Math.abs(y - (r.y + r.h)) <= tol;
  // Corners before edges: on a small layer the two bands overlap, and a corner is the more specific answer.
  if (n && w) return "nw";
  if (n && e) return "ne";
  if (s && w) return "sw";
  if (s && e) return "se";
  if (n) return "n";
  if (s) return "s";
  if (w) return "w";
  if (e) return "e";
  return inside(r, x, y) ? "body" : null;
}

/** How far a grip may travel before it would take the rect under `MIN_SIDE` — the clamp, said once per axis. */
const limit = (d: number, side: number, moving: "lo" | "hi"): number =>
  moving === "lo" ? Math.min(d, side - MIN_SIDE) : Math.max(d, MIN_SIDE - side);

/**
 * The rect a drag lands on. A grip moves the edges it names and leaves the others where they
 * are — the same invariant the timeline's head trim keeps, and the reason a resize is not a move
 * wearing a resize's clothes. Integers, because a frame is measured in whole pixels.
 */
export function dragRect(r: Rect, grip: Grip, dx: number, dy: number): Rect {
  if (grip === "body")
    return { ...r, x: Math.round(r.x + dx), y: Math.round(r.y + dy) };
  const west = grip === "w" || grip === "nw" || grip === "sw";
  const east = grip === "e" || grip === "ne" || grip === "se";
  const north = grip === "n" || grip === "nw" || grip === "ne";
  const south = grip === "s" || grip === "sw" || grip === "se";
  let { x, y, w, h } = r;
  if (west) {
    const d = limit(dx, w, "lo");
    x += d;
    w -= d;
  }
  if (east) w += limit(dx, w, "hi");
  if (north) {
    const d = limit(dy, h, "lo");
    y += d;
    h -= d;
  }
  if (south) h += limit(dy, h, "hi");
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/** The CSS cursor a grip asks for — one table, so the pointer cannot say a different thing from the drag. */
export const CURSOR: Record<Grip, string> = {
  body: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** The eight grips in drawing order, so the overlay and the hit test cannot list different ones. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

/** Where a handle's square sits inside the rect, as a 0..1 fraction of each side. */
export const HANDLE_AT: Record<(typeof HANDLES)[number], [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** Did the drag change anything? A rect that came back where it started writes nothing. */
export const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
