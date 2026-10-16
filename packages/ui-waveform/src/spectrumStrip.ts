// spectrumStrip.ts — the spectrum look over an unbounded strip of columns, rasterised once in
// TILES and blitted at an offset, so a band scrolling at 60 fps paints two images a frame rather
// than every column. A tile is smoothed across its own edges, so tiles meet without a seam.
// See ../docs/spectrum.md.

import {
  type Column,
  paintColumns,
  SMOOTH_RADIUS,
  smoothColumns,
} from "./spectrum";

/** How wide one tile is, in CSS pixels — small enough that rendering one fits inside a frame. */
export const TILE_PX = 512;

/** The tiles a view of `width` px starting at strip column `x0` needs, first to last. */
export function tilesFor(x0: number, width: number, tile = TILE_PX): number[] {
  if (!(width > 0) || !(tile > 0)) return [];
  const first = Math.floor(x0 / tile);
  const last = Math.floor((x0 + width - 1e-9) / tile);
  const out: number[] = [];
  for (let t = first; t <= last; t++) out.push(t);
  return out;
}

/** A strip of columns, asked of `column(g)` for strip column `g`, cached as tiles at one size. */
export class SpectrumStrip {
  private tiles = new Map<number, HTMLCanvasElement>();

  constructor(
    private readonly column: (g: number) => Column | null,
    readonly height: number,
    readonly dpr: number,
    readonly tile = TILE_PX,
  ) {}

  /** Rasterise tile `t`, smoothed against the columns either side of it. */
  private render(t: number): HTMLCanvasElement {
    const r = SMOOTH_RADIUS;
    const first = t * this.tile - r;
    const cols = smoothColumns(
      Array.from({ length: this.tile + 2 * r }, (_, i) =>
        this.column(first + i),
      ),
    );
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(this.tile * this.dpr));
    cv.height = Math.max(1, Math.round(this.height * this.dpr));
    const ctx = cv.getContext("2d");
    if (!ctx) return cv;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    paintColumns(ctx, cols, r, this.tile, this.height);
    return cv;
  }

  private tileAt(t: number): HTMLCanvasElement {
    let cv = this.tiles.get(t);
    if (!cv) {
      cv = this.render(t);
      this.tiles.set(t, cv);
    }
    return cv;
  }

  /** Blit the strip so column `x0` lands at x = 0 across `width` CSS px, in a context scaled to CSS px. */
  draw(ctx: CanvasRenderingContext2D, x0: number, width: number): void {
    const need = tilesFor(x0, width, this.tile);
    const warm = need.every((t) => this.tiles.has(t));
    for (const t of need) {
      // Snapped to a device pixel: a blit at a fractional offset is resampled, and a soft band shimmers.
      const x = Math.round((t * this.tile - x0) * this.dpr) / this.dpr;
      ctx.drawImage(this.tileAt(t), x, 0, this.tile, this.height);
    }
    if (!need.length || !warm) return;
    const lo = need[0] - 1;
    const hi = need[need.length - 1] + 1;
    for (const t of this.tiles.keys())
      if (t < lo || t > hi) this.tiles.delete(t);
    // One neighbour ahead of time, on a frame that rendered nothing else, so crossing into it costs no frame.
    if (!this.tiles.has(hi)) this.tileAt(hi);
    else if (!this.tiles.has(lo)) this.tileAt(lo);
  }
}
