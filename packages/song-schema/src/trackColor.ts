// trackColor.ts — the colour a track's CATEGORY (trackKind.ts) says it with: vox pink, drums red,
// basses brown, guitars green, keys blue, synths purple, the rest grey — in that order on screen.
// Several tracks of one category take shades of its colour, so they stay told apart.
// Pure, no fs: the browser and the compile read the same answer. See docs/trackColor.md.

import { categoryRank, type TrackCategory } from "./trackKind";

// Each category's hue and saturation, and the lightness span its shades are spread over: one track sits in the middle.
const PALETTE: Record<
  TrackCategory,
  { h: number; s: number; lo: number; hi: number }
> = {
  vox: { h: 330, s: 75, lo: 52, hi: 76 },
  drums: { h: 2, s: 72, lo: 40, hi: 64 },
  bass: { h: 25, s: 48, lo: 28, hi: 50 },
  guitar: { h: 130, s: 50, lo: 34, hi: 60 },
  keys: { h: 212, s: 72, lo: 42, hi: 68 },
  synth: { h: 272, s: 58, lo: 46, hi: 72 },
  other: { h: 220, s: 6, lo: 44, hi: 70 },
};

function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** The `i`th of `n` shades of a category: lightness stepped across its span, the hue nudged a little so neighbours differ. */
export function categoryShade(c: TrackCategory, i: number, n: number): string {
  const p = PALETTE[c];
  if (n <= 1) return hsl(p.h, p.s, (p.lo + p.hi) / 2);
  const t = i / (n - 1);
  const nudge = (t - 0.5) * 12;
  return hsl((p.h + nudge + 360) % 360, p.s, p.lo + (p.hi - p.lo) * t);
}

/** Every track's colour, by id: grouped by category, shaded by its place among its own in the given order. */
export function autoColors(
  tracks: readonly { id: string; category: TrackCategory }[],
): Map<string, string> {
  const count = new Map<TrackCategory, number>();
  for (const t of tracks)
    count.set(t.category, (count.get(t.category) ?? 0) + 1);
  const seen = new Map<TrackCategory, number>();
  const out = new Map<string, string>();
  for (const t of tracks) {
    const i = seen.get(t.category) ?? 0;
    seen.set(t.category, i + 1);
    out.set(t.id, categoryShade(t.category, i, count.get(t.category) ?? 1));
  }
  return out;
}

/** The tracks laid out by category, stable within one — the order `track arrange` states. */
export function arrangeByCategory<T>(
  tracks: readonly T[],
  categoryOf: (t: T) => TrackCategory,
): T[] {
  return tracks
    .map((t, i) => ({ t, i, r: categoryRank(categoryOf(t)) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}
