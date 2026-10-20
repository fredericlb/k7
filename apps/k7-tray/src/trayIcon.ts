// trayIcon.ts — the menu-bar icon drawn in code: four states, one animated, light or dark ink. See docs/tray.md.
// Shapes are described in a 0..1 unit square, rasterized 3× oversampled and box-filtered; the output is a PNG.

import { deflateSync } from "node:zlib";
import type { IconState } from "./status.ts";

/** 22pt @2x, the menu-bar size. */
export const ICON_PX = 44;
const SS = 3;
const S = ICON_PX * SS;

type Rgba = readonly [number, number, number, number];
type Shape = (u: number, v: number) => boolean;

const GREEN: Rgba = [0.2, 0.78, 0.35, 1];
const RED: Rgba = [1, 0.27, 0.23, 1];
const AMBER: Rgba = [1, 0.62, 0.04, 1];
const BLUE: Rgba = [0.04, 0.52, 1, 1];

/** Straight-alpha RGBA, four floats per oversampled pixel. */
class Canvas {
  readonly px = new Float32Array(S * S * 4);

  fill(color: Rgba, inside: Shape): void {
    const a = color[3];
    for (let y = 0; y < S; y++) {
      const v = (y + 0.5) / S;
      for (let x = 0; x < S; x++) {
        if (!inside((x + 0.5) / S, v)) continue;
        const i = (y * S + x) * 4;
        const da = this.px[i + 3];
        const outA = a + da * (1 - a);
        for (let c = 0; c < 3; c++)
          this.px[i + c] =
            outA <= 0
              ? 0
              : (color[c] * a + this.px[i + c] * da * (1 - a)) / outA;
        this.px[i + 3] = outA;
      }
    }
  }

  /** Destination-out: a cleared gap so the badge reads as its own token. */
  erase(inside: Shape): void {
    for (let y = 0; y < S; y++) {
      const v = (y + 0.5) / S;
      for (let x = 0; x < S; x++)
        if (inside((x + 0.5) / S, v))
          this.px.fill(0, (y * S + x) * 4, (y * S + x) * 4 + 4);
    }
  }

  /** Box-filter down, averaging in PREMULTIPLIED space so transparent pixels don't fringe the edges. */
  finish(): Uint8Array {
    const out = new Uint8Array(ICON_PX * ICON_PX * 4);
    const n = SS * SS;
    for (let y = 0; y < ICON_PX; y++)
      for (let x = 0; x < ICON_PX; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let dy = 0; dy < SS; dy++)
          for (let dx = 0; dx < SS; dx++) {
            const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
            const pa = this.px[i + 3];
            r += this.px[i] * pa;
            g += this.px[i + 1] * pa;
            b += this.px[i + 2] * pa;
            a += pa;
          }
        const o = (y * ICON_PX + x) * 4;
        const un = (c: number) =>
          a <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, c / a)) * 255);
        out[o] = un(r);
        out[o + 1] = un(g);
        out[o + 2] = un(b);
        out[o + 3] = Math.round((a / n) * 255);
      }
    return out;
  }
}

const rect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (u, v) =>
    u >= x0 && u <= x1 && v >= y0 && v <= y1;

const disc =
  (cx: number, cy: number, r: number): Shape =>
  (u, v) =>
    (u - cx) ** 2 + (v - cy) ** 2 <= r * r;

/** An arc of an annulus, `sweep` radians from `from`, clockwise in screen coordinates: the spinner's tail. */
const arc =
  (
    cx: number,
    cy: number,
    r: number,
    width: number,
    from: number,
    sweep: number,
  ): Shape =>
  (u, v) => {
    const d = Math.hypot(u - cx, v - cy);
    if (d < r - width / 2 || d > r + width / 2) return false;
    const tau = Math.PI * 2;
    const a = (((Math.atan2(v - cy, u - cx) - from) % tau) + tau) % tau;
    return a <= sweep;
  };

/** A triangle by half-plane tests. */
const tri =
  (p: readonly [number, number][]): Shape =>
  (u, v) => {
    const side = (a: [number, number], b: [number, number]) =>
      (b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0]);
    const s = [side(p[0], p[1]), side(p[1], p[2]), side(p[2], p[0])];
    return s.every((x) => x >= 0) || s.every((x) => x <= 0);
  };

/** The icon's pixels, `dark` meaning light ink for a dark menu bar. */
export function renderRgba(state: IconState, dark: boolean): Uint8Array {
  const ink: Rgba = dark ? [0.96, 0.96, 0.96, 1] : [0.13, 0.13, 0.13, 1];
  const c = new Canvas();

  // The mark — three bars and a note — sized against the badge's clear ring, which must miss the note head.
  const g = 0.82;
  const tx = 0.03 - 0.06 * g;
  const ty = 0.07 - 0.22 * g;
  const m = (x0: number, y0: number, x1: number, y1: number) =>
    rect(x0 * g + tx, y0 * g + ty, x1 * g + tx, y1 * g + ty);
  c.fill(ink, m(0.06, 0.22, 0.6, 0.32));
  c.fill(ink, m(0.06, 0.4, 0.6, 0.5));
  c.fill(ink, m(0.06, 0.58, 0.42, 0.68));
  c.fill(ink, m(0.64, 0.22, 0.94, 0.32));
  c.fill(ink, m(0.84, 0.22, 0.94, 0.78));
  c.fill(ink, disc(0.74 * g + tx, 0.78 * g + ty, 0.155 * g));

  const bx = 0.82;
  const by = 0.82;
  const br = 0.17;
  c.erase(disc(bx, by, br * 1.22));
  if (state.kind === "running") c.fill(GREEN, disc(bx, by, br));
  else if (state.kind === "stopped") c.fill(RED, disc(bx, by, br));
  else if (state.kind === "error") {
    // A warning triangle, not a dot: shape says "can't start" without relying on telling red from amber.
    const t = br * 1.15;
    const h = br * 0.95;
    c.fill(
      AMBER,
      tri([
        [bx, by - h],
        [bx + t, by + h * 0.85],
        [bx - t, by + h * 0.85],
      ]),
    );
    const stroke: Rgba = [0.12, 0.1, 0.02, 1];
    c.fill(stroke, rect(bx - 0.022, by - h * 0.3, bx + 0.022, by + h * 0.3));
    c.fill(stroke, disc(bx, by + h * 0.58, 0.03));
  } else {
    const tau = Math.PI * 2;
    c.fill(
      BLUE,
      arc(bx, by, br * 0.78, br * 0.52, state.frame * (tau / 10), tau * 0.72),
    );
  }
  return c.finish();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A square RGBA image as a PNG: unfiltered rows, one IDAT. */
export function encodePng(rgba: Uint8Array, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    raw.set(
      rgba.subarray(y * size * 4, (y + 1) * size * 4),
      y * (size * 4 + 1) + 1,
    );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

export function renderPng(state: IconState, dark: boolean): Buffer {
  return encodePng(renderRgba(state, dark), ICON_PX);
}
