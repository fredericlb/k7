// cableCanvas.ts — the cables drawn onto a 2D canvas instead of SVG paths: the same
// Catmull-Rom cubics traced with numbers, a live cable displaced into a reused buffer,
// and shadow-then-cable stroked from ONE traced geometry. Pure drawing over the laid-out
// graph (cables.ts owns the math); no DOM type, no React. See docs/wobble.md.

import type { CableGeom } from "./cables";
import type { Pt } from "./graph";

// Cable wobble — a travelling sine on a live cable. Amplitudes are WORLD units, so they scale with zoom.
export const WOBBLE_AMP = 2.5; // peak perpendicular displacement, world px
export const WOBBLE_WAVELENGTH = 40; // world px between crests
export const WOBBLE_HZ = 1.2; // crests per second travelling down the cable
export const WOBBLE_STEP = 8; // densify a segment to ~this spacing so the curve is smooth
export const WOBBLE_MAX_SAMPLES = 96; // cap per edge, so a very long cable can't explode the point count

// The wobble is an ornament at 1.2 Hz; redrawing it at a 149 Hz screen's rate is rasterising
// five frames nobody can tell apart. A camera move is NOT throttled by this — see DomChains.
export const WOBBLE_FPS = 30;

// Stroke widths in WORLD px, the numbers .dgx-cbl / .dgx-cbl-shadow carried inline in the SVG.
export const CABLE_W = 2.2;
export const SHADOW_W = 4.4;
// .dgx-cbl-shadow was `stroke:#000; stroke-opacity:.5`, which canvas spells as one colour.
export const SHADOW_COLOR = "rgba(0,0,0,.5)";

/**
 * Only what this file calls on a canvas context, so a test can pass a recorder instead.
 *
 * A real `CanvasRenderingContext2D` satisfies it structurally, which is the point: this
 * package draws, and depending on the DOM's types to do it would put a lib requirement on
 * every consumer for six method signatures.
 */
export interface CableCtx {
  lineWidth: number;
  // A colour string is all this file ever assigns; the `object` arm is only what lets a real
  // context — which also takes a gradient or a pattern — satisfy this interface.
  strokeStyle: string | object;
  lineCap: string;
  lineJoin: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): void;
  stroke(): void;
}

/** The flat `[x0,y0,x1,y1,…]` scratch every draw reuses. Held by the caller, grown here. */
export interface CableScratch {
  buf: Float64Array;
}

export const newScratch = (): CableScratch => ({
  buf: new Float64Array(WOBBLE_MAX_SAMPLES * 2),
});

// Grow the scratch to hold `count` points, keeping nothing: every user fills it before reading.
function room(s: CableScratch, count: number): Float64Array {
  if (count * 2 > s.buf.length) s.buf = new Float64Array(count * 2);
  return s.buf;
}

/**
 * A still cable's points, flattened into the scratch. Returns the point count.
 *
 * The base polyline is what `smoothPath` drew at rest, so tracing it through the same
 * `tracePolyline` below is what makes a cable's shape independent of whether it is live.
 */
export function flattenInto(s: CableScratch, pts: readonly Pt[]): number {
  const xy = room(s, pts.length);
  for (let i = 0; i < pts.length; i++) {
    xy[i * 2] = pts[i].x;
    xy[i * 2 + 1] = pts[i].y;
  }
  return pts.length;
}

/**
 * A live cable's points, displaced along their own normals by a travelling sine, into the
 * scratch. Returns the point count.
 *
 * The envelope is `sin(πu)`, zero at both ends, so a live cable's endpoints sit exactly where
 * the still one's do — which is why the label and the arrowhead never have to be redrawn.
 * Allocates nothing but the buffer it may have to grow.
 */
export function wobbleInto(
  s: CableScratch,
  g: CableGeom,
  phase: number,
  amp = WOBBLE_AMP,
  waveLength = WOBBLE_WAVELENGTH,
): number {
  const n = g.samples.length;
  // maxSamples is a target, not a ceiling — a many-waypoint cable gets one sample per segment.
  const xy = room(s, n);
  const k = (Math.PI * 2) / waveLength;
  for (let i = 0; i < n; i++) {
    const p = g.samples[i];
    const u = g.len > 0 ? p.s / g.len : 0;
    const off = amp * Math.sin(Math.PI * u) * Math.sin(k * p.s - phase);
    xy[i * 2] = p.x + p.nx * off;
    xy[i * 2 + 1] = p.y + p.ny * off;
  }
  return n;
}

/**
 * Trace a flat point buffer as the SAME cubics `smoothPath`/`cubicSegments` describe, into
 * the context's current path.
 *
 * This is the whole safety argument of leaving SVG: the control points below must be the ones
 * `cubicSegments` computes, or a cable changes shape the day it stops being a string. A test
 * asserts exactly that, which is what `smoothPathXY`'s byte-identity test used to do.
 */
export function tracePolyline(
  ctx: CableCtx,
  xy: ArrayLike<number>,
  count: number,
): void {
  if (count < 2) return;
  ctx.moveTo(xy[0], xy[1]);
  if (count === 2) {
    ctx.lineTo(xy[2], xy[3]);
    return;
  }
  const last = count - 1;
  for (let i = 0; i < last; i++) {
    // The same four points cubicSegments takes, as offsets into the flat buffer.
    const p0 = Math.max(0, i - 1) * 2;
    const p1 = i * 2;
    const p2 = (i + 1) * 2;
    const p3 = Math.min(last, i + 2) * 2;
    ctx.bezierCurveTo(
      xy[p1] + (xy[p2] - xy[p0]) / 6,
      xy[p1 + 1] + (xy[p2 + 1] - xy[p0 + 1]) / 6,
      xy[p2] - (xy[p3] - xy[p1]) / 6,
      xy[p2 + 1] - (xy[p3 + 1] - xy[p1 + 1]) / 6,
      xy[p2],
      xy[p2 + 1],
    );
  }
}

// One cable to draw: its geometry, the colour it carries, and whether it is rippling.
export interface CableDraw {
  geom: CableGeom;
  color: string;
  live: boolean;
}

// Everything one frame of the cable layer needs. `width`/`height` are DEVICE pixels.
export interface CableFrame {
  width: number;
  height: number;
  cam: { x: number; y: number; k: number };
  dpr: number;
  cables: readonly CableDraw[];
  phase: number;
  // World-unit stroke multiplier that grows as the camera pulls back, keeping on-screen thickness constant.
  boost: number;
}

/**
 * Draw the whole signal-cable layer.
 *
 * The canvas lives OUTSIDE the panned/zoomed world element — a canvas scaled by CSS goes
 * blurry — so the camera is applied to the context instead, and everything below is in world
 * coordinates exactly as the SVG was.
 */
export function drawCables(
  ctx: CableCtx,
  f: CableFrame,
  scratch: CableScratch,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, f.width, f.height);
  const s = f.dpr * f.cam.k;
  ctx.setTransform(s, 0, 0, s, f.dpr * f.cam.x, f.dpr * f.cam.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const c of f.cables) {
    const n = c.live
      ? wobbleInto(scratch, c.geom, f.phase)
      : flattenInto(scratch, c.geom.base);
    if (n < 2) continue;
    ctx.beginPath();
    tracePolyline(ctx, scratch.buf, n);
    // Shadow then cable, per cable rather than in two passes — the SVG painted them in this
    // order inside one <g> each, so a crossing cable's shadow falls on its neighbour the same way.
    ctx.strokeStyle = SHADOW_COLOR;
    ctx.lineWidth = SHADOW_W * f.boost;
    ctx.stroke();
    ctx.strokeStyle = c.color;
    ctx.lineWidth = CABLE_W * f.boost;
    ctx.stroke();
  }
}
