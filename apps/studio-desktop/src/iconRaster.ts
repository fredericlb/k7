// iconRaster.ts — the menu-bar mark, drawn in code: four states, one animated, and a
// light/dark flip that would otherwise be an asset per state per frame per appearance.
// Described in a UNIT SQUARE and 3× oversampled, so the geometry has one definition and a
// fifth state stays a shape. Pure arithmetic on purpose — no electron import — so the pixels
// can be asserted without a browser process. See docs/trayIcon.md.

/** Straight (non-premultiplied) alpha, 0..1. */
type Rgba = readonly [number, number, number, number];

const SS = 3;

const GREEN: Rgba = [0.2, 0.78, 0.35, 1]; // running
const RED: Rgba = [1, 0.27, 0.23, 1]; //     stopped
const AMBER: Rgba = [1, 0.62, 0.04, 1]; //   can't start
const BLUE: Rgba = [0.04, 0.52, 1, 1]; //    loading

/** How many spinner frames a full turn takes; the menu's braille spinner shares the tick. */
export const SPINNER_FRAMES = 10;

/**
 * What the corner badge is saying — distinct from the engine's status: "running but still
 * scanning" is one status and two different icons.
 */
export type IconState =
  | { kind: "running" }
  | { kind: "stopped" }
  | { kind: "error" }
  | { kind: "loading"; frame: number };

type Inside = (u: number, v: number) => boolean;

const rect =
  (x0: number, y0: number, x1: number, y1: number): Inside =>
  (u, v) =>
    u >= x0 && u <= x1 && v >= y0 && v <= y1;

const disc =
  (cx: number, cy: number, r: number): Inside =>
  (u, v) =>
    (u - cx) ** 2 + (v - cy) ** 2 <= r * r;

/** An annulus sector `sweep` radians wide from `from`, clockwise in screen coordinates: the spinner's tail. */
const arc =
  (
    cx: number,
    cy: number,
    r: number,
    width: number,
    from: number,
    sweep: number,
  ): Inside =>
  (u, v) => {
    const dx = u - cx;
    const dy = v - cy;
    const d = Math.hypot(dx, dy);
    if (d < r - width / 2 || d > r + width / 2) return false;
    const a = (((Math.atan2(dy, dx) - from) % TAU) + TAU) % TAU;
    return a <= sweep;
  };

/** Triangle by half-plane tests; points given clockwise. */
const tri = (p: readonly [number, number][]): Inside => {
  const side = (
    a: readonly [number, number],
    b: readonly [number, number],
    u: number,
    v: number,
  ) => (b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0]);
  return (u, v) => {
    const s0 = side(p[0], p[1], u, v);
    const s1 = side(p[1], p[2], u, v);
    const s2 = side(p[2], p[0], u, v);
    return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
  };
};

const TAU = Math.PI * 2;

class Canvas {
  readonly px: Float32Array;

  constructor(readonly s: number) {
    this.px = new Float32Array(s * s * 4);
  }

  /** Composite `color` wherever `inside` is true; `inside` takes unit coordinates. */
  fill(color: Rgba, inside: Inside): void {
    const { s, px } = this;
    for (let y = 0; y < s; y++) {
      const v = (y + 0.5) / s;
      for (let x = 0; x < s; x++) {
        const u = (x + 0.5) / s;
        if (!inside(u, v)) continue;
        const i = (y * s + x) * 4;
        const a = color[3];
        const da = px[i + 3] as number;
        const outA = a + da * (1 - a);
        for (let c = 0; c < 3; c++) {
          const dst = px[i + c] as number;
          px[i + c] =
            outA <= 0 ? 0 : (color[c] * a + dst * da * (1 - a)) / outA;
        }
        px[i + 3] = outA;
      }
    }
  }

  /** Punch a hole (destination-out), so the badge reads as its own token and not part of the note head. */
  erase(inside: Inside): void {
    const { s, px } = this;
    for (let y = 0; y < s; y++) {
      const v = (y + 0.5) / s;
      for (let x = 0; x < s; x++) {
        if (!inside((x + 0.5) / s, v)) continue;
        px.fill(0, (y * s + x) * 4, (y * s + x) * 4 + 4);
      }
    }
  }

  /**
   * Box-filter SS×SS blocks down. Averaging happens in PREMULTIPLIED space — straight alpha
   * would drag the colour of fully transparent pixels into the edges and fringe the glyph.
   */
  finish(n: number): Buffer {
    const { s, px } = this;
    const out = Buffer.alloc(n * n * 4);
    const denom = SS * SS;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let dy = 0; dy < SS; dy++) {
          for (let dx = 0; dx < SS; dx++) {
            const i = ((y * SS + dy) * s + (x * SS + dx)) * 4;
            const pa = px[i + 3] as number;
            r += (px[i] as number) * pa;
            g += (px[i + 1] as number) * pa;
            b += (px[i + 2] as number) * pa;
            a += pa;
          }
        }
        r /= denom;
        g /= denom;
        b /= denom;
        a /= denom;
        const un = (c: number) =>
          a <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, c / a)) * 255);
        const o = (y * n + x) * 4;
        out[o] = un(r);
        out[o + 1] = un(g);
        out[o + 2] = un(b);
        out[o + 3] = Math.round(a * 255);
      }
    }
    return out;
  }
}

/** The RGBA bytes of one icon, `n` pixels square. `dark` inverts the glyph, the mark being invisible otherwise. */
export function renderIcon(
  state: IconState,
  dark: boolean,
  attention: boolean,
  n: number,
): Buffer {
  const ink: Rgba = dark ? [0.96, 0.96, 0.96, 1] : [0.13, 0.13, 0.13, 1];
  const c = new Canvas(n * SS);

  // The mark: three bars then the note, authored in its own 0..1 space and mapped up and left.
  const g = 0.82;
  const tx = 0.03 - 0.06 * g;
  const ty = 0.07 - 0.22 * g;
  const m = (x0: number, y0: number, x1: number, y1: number) =>
    rect(x0 * g + tx, y0 * g + ty, x1 * g + tx, y1 * g + ty);
  c.fill(ink, m(0.06, 0.22, 0.6, 0.32));
  c.fill(ink, m(0.06, 0.4, 0.6, 0.5));
  c.fill(ink, m(0.06, 0.58, 0.42, 0.68));
  c.fill(ink, m(0.64, 0.22, 0.94, 0.32)); // the note's flag
  c.fill(ink, m(0.84, 0.22, 0.94, 0.78)); // stem
  c.fill(ink, disc(0.74 * g + tx, 0.78 * g + ty, 0.155 * g)); // head

  // The badge, bottom-right, with a cleared ring so it never merges with the mark.
  const bx = 0.82;
  const by = 0.82;
  const br = 0.17;
  c.erase(disc(bx, by, br * 1.22));
  switch (state.kind) {
    case "running":
      c.fill(GREEN, disc(bx, by, br));
      break;
    case "stopped":
      c.fill(RED, disc(bx, by, br));
      break;
    case "error": {
      // A triangle, not a dot: "can't start" is a different KIND of thing from "off", and
      // shape carries that without relying on the user telling red from amber.
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
      break;
    }
    case "loading": {
      // A ¾ arc spun by frame index — the same tick that animates the "Plugins" line.
      const from = state.frame * (TAU / SPINNER_FRAMES);
      c.fill(BLUE, arc(bx, by, br * 0.78, br * 0.52, from, TAU * 0.72));
      break;
    }
  }

  if (attention) {
    // Its OWN corner rather than replacing the badge: the engine can be happily running while
    // a browser is locked out, and both have to be readable at once.
    const ax = 0.86;
    const ay = 0.14;
    const ar = 0.13;
    c.erase(disc(ax, ay, ar * 1.35));
    c.fill(AMBER, disc(ax, ay, ar));
  }

  return c.finish(n);
}
