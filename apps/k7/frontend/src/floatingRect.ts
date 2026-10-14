// floatingRect.ts — the geometry of a floating window: where it first sits, and the clamp that
// keeps its title bar reachable in a window that shrank (the gestures are react-rnd's). Kept per
// browser in localStorage, not in the project: where a window sits is a habit of this screen.
// See docs/picture.md.

export interface FloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_W = 200;
export const MIN_H = 140;
/** How much of the window must stay on screen, so its title bar can always be grabbed back. */
const GRIP = 48;

/** No larger than the screen, and never so far off it that the title bar is out of reach. */
export function clampRect(r: FloatRect, vw: number, vh: number): FloatRect {
  const w = Math.min(Math.max(MIN_W, r.w), Math.max(MIN_W, vw));
  const h = Math.min(Math.max(MIN_H, r.h), Math.max(MIN_H, vh));
  const x = Math.min(Math.max(r.x, GRIP - w), vw - GRIP);
  const y = Math.min(Math.max(r.y, 0), vh - GRIP);
  return { x, y, w, h };
}

/** The first placement: a 16:9 window in the bottom-right corner, a third of the screen wide. */
export function defaultRect(vw: number, vh: number): FloatRect {
  const w = Math.max(MIN_W, Math.round(vw / 3));
  const h = Math.max(MIN_H, Math.round((w * 9) / 16) + 28);
  return clampRect({ x: vw - w - 16, y: vh - h - 64, w, h }, vw, vh);
}

const isRect = (v: unknown): v is FloatRect =>
  !!v &&
  typeof v === "object" &&
  ["x", "y", "w", "h"].every((k) =>
    Number.isFinite((v as Record<string, unknown>)[k]),
  );

/** What is kept of a window: where it sits (null until it was first moved) and whether it is up. */
export interface FloatState {
  rect: FloatRect | null;
  open: boolean;
}

/** The saved state, or a window never touched — silent about a storage that refuses to answer. */
export function loadFloat(key: string): FloatState {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    return {
      rect: isRect(parsed?.rect) ? parsed.rect : null,
      open: parsed?.open !== false,
    };
  } catch {
    return { rect: null, open: true };
  }
}

export function saveFloat(key: string, { rect, open }: FloatState): void {
  try {
    localStorage.setItem(key, JSON.stringify({ rect, open }));
  } catch {
    /* no storage: the window still works, it simply opens where it opened last time */
  }
}
