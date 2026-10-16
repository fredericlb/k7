// envelope.ts — a clip's dB envelope as pixels: amplitude to dB to y, the contour one column per
// pixel, and the envelope rasterised once into a layer the canvas blits. See docs/envelopes.md.

const MIN_DB = -120; // bottom of the vertical scale (0 dBFS at the top)

export const ampToDb = (amp: number): number =>
  amp > 0 ? 20 * Math.log10(amp) : MIN_DB;

// The dB scale, absolute: MIN_DB at the bottom, 0 dBFS at the top, both envelopes linear — see docs/envelopes.md.
export const dbToYIn = (db: number, h: number): number => {
  const norm = Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB));
  return h - norm * h;
};

/** One y per pixel column: interpolate when zoomed in, average when zoomed out — run twice, see docs/envelopes.md. */
export function contourYs(
  samples: number[],
  intervalMs: number,
  width: number,
  v0: number,
  span: number,
  height: number,
): number[] {
  const n = samples.length;
  const dt = intervalMs / 1000;
  const toTime = (x: number) => (width > 0 ? v0 + (x / width) * span : v0);
  // dB per sample, lightly averaged to take the edge off single-sample spikes.
  const R = 1; // smoothing radius, in samples
  const sdb = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = i - R; k <= i + R; k++) {
      if (k >= 0 && k < n) {
        sum += ampToDb(samples[k]);
        cnt++;
      }
    }
    sdb[i] = cnt ? sum / cnt : MIN_DB;
  }
  const out = new Array<number>(Math.max(1, width));
  for (let px = 0; px < width; px++) {
    const a = toTime(px) / dt;
    const b = toTime(px + 1) / dt;
    let db: number;
    if (b - a >= 1) {
      const i0 = Math.max(0, Math.floor(a));
      const i1 = Math.min(n, Math.ceil(b));
      let sum = 0;
      let cnt = 0;
      for (let i = i0; i < i1; i++) {
        sum += sdb[i];
        cnt++;
      }
      db = cnt ? sum / cnt : MIN_DB;
    } else {
      const c = (a + b) / 2;
      const i = Math.floor(c);
      const f = c - i;
      const s0 = sdb[Math.max(0, Math.min(n - 1, i))];
      const s1 = sdb[Math.max(0, Math.min(n - 1, i + 1))];
      db = s0 + (s1 - s0) * f;
    }
    out[px] = dbToYIn(db, height);
  }
  return out;
}

/** One envelope contour rasterised onto a canvas of its own, drawn once and then blitted — see docs/layers.md. */
export function envelopeLayer(
  ys: number[],
  width: number,
  height: number,
  dpr: number,
  rgb: string,
  /** Scales both the fill and the line — 1 is the solid contour, less is the one behind it. */
  alpha = 1,
): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(width * dpr));
  cv.height = Math.max(1, Math.round(height * dpr));
  const ctx = cv.getContext("2d");
  if (!ctx || width < 2) return cv;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Smooth curve through the points via quadratic segments to the midpoints.
  const contour = () => {
    for (let x = 0; x < width - 1; x++) {
      const xc = (x + x + 1) / 2;
      const yc = (ys[x] + ys[x + 1]) / 2;
      ctx.quadraticCurveTo(x, ys[x], xc, yc);
    }
    ctx.lineTo(width - 1, ys[width - 1]);
  };

  // A soft filled area…
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, ys[0]);
  contour();
  ctx.lineTo(width - 1, height);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, `rgba(${rgb}, ${0.22 * alpha})`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fill();

  // …under a top line.
  ctx.beginPath();
  ctx.moveTo(0, ys[0]);
  contour();
  ctx.strokeStyle = `rgba(${rgb}, ${0.9 * alpha})`;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.stroke();
  return cv;
}
