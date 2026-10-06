// spectrum.ts — the SPECTRUM look: one column per pixel, mirrored about the middle, as tall as
// its linear peak and coloured by what is IN it. The DJ desk's band and the shared canvas both
// paint through `spectrumColumns`, which is what makes it one waveform. See ../docs/spectrum.md.

import { type Bands, bandsAt, columnColour } from "./spectrumColour";

export {
  BAND_COLOURS,
  type Bands,
  bandsAt,
  columnColour,
} from "./spectrumColour";

/** What a column with no band analysis is drawn in — grey, which reads as "not analysed that way". */
export const PLAIN = "rgb(148,163,184)";

/** One pixel column: its height, 0..1 of full scale, and its bands, or null when the file has none. */
export interface Column {
  amp: number;
  bands: Bands | null;
}

/** The envelope fields the look reads, all in the same bucket space. */
export interface SpectrumSource {
  intervalMs: number;
  samples: number[];
  peak?: number[];
  low?: number[];
  mid?: number[];
  high?: number[];
}

/** How far, in columns, the painter's smoothing reaches on each side — docs/spectrum.md. */
export const SMOOTH_RADIUS = 2;

/** A triangular smoothing over neighbouring columns, amplitude and bands alike; an empty column stays empty. */
export function smoothColumns(
  cols: (Column | null)[],
  radius = SMOOTH_RADIUS,
): (Column | null)[] {
  if (radius < 1) return cols;
  return cols.map((c, px) => {
    if (!c) return null;
    let w = 0;
    let amp = 0;
    let banded = c.bands !== null;
    const b = { low: 0, mid: 0, high: 0 };
    for (let k = -radius; k <= radius; k++) {
      const n = cols[px + k];
      if (!n) continue;
      const weight = radius + 1 - Math.abs(k);
      w += weight;
      amp += n.amp * weight;
      if (!n.bands) {
        banded = false;
        continue;
      }
      b.low += n.bands.low * weight;
      b.mid += n.bands.mid * weight;
      b.high += n.bands.high * weight;
    }
    // Colour is a ratio between bands, so the shared weight need not be divided out of it.
    return { amp: amp / w, bands: banded ? b : c.bands };
  });
}

/** One column read BETWEEN two buckets at fractional index `pos` (bucket centres at i), so a zoom-in slopes instead of stepping. */
export function interpolated(
  src: { amps: number[]; low?: number[]; mid?: number[]; high?: number[] },
  pos: number,
): Column | null {
  const n = src.amps.length;
  if (!(n > 0) || pos < -0.5 || pos > n - 0.5) return null;
  const p = Math.max(0, Math.min(n - 1, pos));
  const i = Math.floor(p);
  const j = Math.min(n - 1, i + 1);
  const f = p - i;
  const lerp = (a: number[]) => a[i] + (a[j] - a[i]) * f;
  const banded = bandsAt(src, i) !== null && bandsAt(src, j) !== null;
  return {
    amp: lerp(src.amps),
    bands: banded
      ? {
          low: lerp(src.low as number[]),
          mid: lerp(src.mid as number[]),
          high: lerp(src.high as number[]),
        }
      : null,
  };
}

/** Paint `width` columns, each asked of `column(px)` and then smoothed; a null leaves that pixel empty. */
export function spectrumColumns(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  column: (px: number) => Column | null,
): void {
  const mid = Math.round(height / 2) + 0.5;
  const cols = smoothColumns(
    Array.from({ length: width }, (_, px) => column(px)),
  );
  for (let px = 0; px < width; px++) {
    const c = cols[px];
    if (!c) continue;
    ctx.fillStyle = c.bands ? columnColour(c.bands, PLAIN) : PLAIN;
    const half = Math.max(0.5, c.amp * (height / 2 - 1));
    ctx.fillRect(px, mid - half, 1, half * 2);
  }
}

/** Where an amplitude sits on the mirrored axis, above and below the middle — for a threshold drawn on this look. */
export function mirroredYs(amp: number, height: number): [number, number] {
  const mid = Math.round(height / 2) + 0.5;
  const half = Math.max(0.5, amp * (height / 2 - 1));
  return [mid - half, mid + half];
}

/** One column per pixel over `[v0, v0 + span]`: the MAX of every bucket it covers, peak and bands alike. */
export function columnsOf(
  env: SpectrumSource,
  width: number,
  v0: number,
  span: number,
): (Column | null)[] {
  const amps = env.peak?.length ? env.peak : env.samples;
  const n = amps.length;
  const dt = env.intervalMs / 1000;
  const out: (Column | null)[] = new Array(Math.max(0, width)).fill(null);
  if (!(n > 0) || !(dt > 0) || !(width > 0) || !(span > 0)) return out;
  const banded = bandsAt(env, 0) !== null;
  for (let px = 0; px < width; px++) {
    const t0 = v0 + (px / width) * span;
    const t1 = v0 + ((px + 1) / width) * span;
    const i0 = Math.floor(t0 / dt);
    const i1 = Math.max(i0 + 1, Math.ceil(t1 / dt));
    if (i1 <= 0 || i0 >= n) continue;
    // Zoomed in, a column is narrower than a bucket: read between bucket centres rather than repeat one.
    if (i1 - i0 <= 1) {
      out[px] = interpolated(
        { amps, low: env.low, mid: env.mid, high: env.high },
        (t0 + t1) / 2 / dt - 0.5,
      );
      continue;
    }
    let amp = 0;
    const b = { low: 0, mid: 0, high: 0 };
    for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) {
      if (amps[i] > amp) amp = amps[i];
      const at = banded ? bandsAt(env, i) : null;
      if (!at) continue;
      if (at.low > b.low) b.low = at.low;
      if (at.mid > b.mid) b.mid = at.mid;
      if (at.high > b.high) b.high = at.high;
    }
    out[px] = { amp, bands: banded ? b : null };
  }
  return out;
}

/** The columns rasterised onto a canvas of their own, drawn once and blitted like the contour — docs/layers.md. */
export function spectrumLayer(
  cols: (Column | null)[],
  width: number,
  height: number,
  dpr: number,
  alpha = 1,
): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(width * dpr));
  cv.height = Math.max(1, Math.round(height * dpr));
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = alpha;
  spectrumColumns(ctx, width, height, (px) => cols[px] ?? null);
  return cv;
}
