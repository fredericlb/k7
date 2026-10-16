// keyframes.ts — a shot's ANIMATION: each property one number, or keyframes in seconds from the
// shot's own start, so the animation travels with the shot when it is moved or split. Pure and
// browser-safe: the compile validates it, the compositor evaluates it every frame, and a split
// re-bases it. The one thing a reader gets wrong: a key's `ease` shapes the segment that LEAVES
// it, not the one arriving. See packages/song-video/docs/animation.md.

import { z } from "zod";

/** How a segment travels from its key to the next; `hold` stays put and jumps at the next key. */
export const EASES = ["linear", "in", "out", "inout", "hold"] as const;
export type Ease = (typeof EASES)[number];

/** One key, normalised: when (seconds from the shot's start), what, and how it leaves. */
export interface Key {
  t: number;
  v: number;
  ease: Ease;
}

/** A property as written: a constant, or keys — `[t, v]` pairs, or `{ t, v, ease }` where the ease matters. */
export const AnimatedSchema = z.union([
  z.number(),
  z
    .array(
      z.union([
        z.tuple([z.number(), z.number()]),
        z
          .object({
            t: z.number(),
            v: z.number(),
            ease: z.enum(EASES).optional(),
          })
          .strict(),
      ]),
    )
    .min(1),
]);
export type Animated = z.infer<typeof AnimatedSchema>;

/** What a shot may animate, each relative to its lane: an offset in px, a scale about the rect's centre, an opacity, a turn in degrees. */
export const ANIMATED_PROPS = ["x", "y", "scale", "opacity", "rotate"] as const;
export type AnimatedProp = (typeof ANIMATED_PROPS)[number];

/** Each property's value when the shot says nothing — the lane's rect as it is. */
const REST: Readonly<Record<AnimatedProp, number>> = {
  x: 0,
  y: 0,
  scale: 1,
  opacity: 1,
  rotate: 0,
};

/** A placement's `animate:` map; strict, so a mistyped property is named on its line rather than ignored. */
export const AnimateSchema = z
  .object(
    Object.fromEntries(
      ANIMATED_PROPS.map((p) => [p, AnimatedSchema.optional()]),
    ) as Record<AnimatedProp, z.ZodOptional<typeof AnimatedSchema>>,
  )
  .strict();
export type Animate = Partial<Record<AnimatedProp, Animated>>;

/** The keys of one property, sorted by time; a constant is one key. */
export function keysOf(a: Animated): Key[] {
  if (typeof a === "number") return [{ t: 0, v: a, ease: "linear" }];
  return a
    .map(
      (k): Key =>
        Array.isArray(k)
          ? { t: k[0], v: k[1], ease: "linear" }
          : { t: k.t, v: k.v, ease: k.ease ?? "linear" },
    )
    .sort((p, q) => p.t - q.t);
}

// The eased fraction of a segment, `u` in 0..1; quadratic, which is as much curve as a hand asks of a pan.
function eased(ease: Ease, u: number): number {
  switch (ease) {
    case "hold":
      return 0;
    case "in":
      return u * u;
    case "out":
      return u * (2 - u);
    case "inout":
      return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    default:
      return u;
  }
}

/** The value of sorted `keys` at `t`: held before the first and after the last, eased in between. */
export function valueAt(keys: readonly Key[], t: number): number {
  const first = keys[0];
  if (!first) return 0;
  if (t <= first.t) return first.v;
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i] as Key;
    const b = keys[i + 1] as Key;
    if (t < b.t) {
      const span = b.t - a.t;
      const u = span > 0 ? (t - a.t) / span : 1;
      return a.v + (b.v - a.v) * eased(a.ease, u);
    }
  }
  return (keys[keys.length - 1] as Key).v;
}

/** Every property of a shot at `t` seconds into it, the unstated ones at rest. */
export function transformAt(
  animate: Animate | undefined,
  t: number,
): Record<AnimatedProp, number> {
  const out = { ...REST };
  if (!animate) return out;
  for (const p of ANIMATED_PROPS) {
    const a = animate[p];
    if (a !== undefined) out[p] = valueAt(keysOf(a), t);
  }
  return out;
}

// Keys back in the file's spelling: a pair when linear, a map when the ease has to be said.
const written = (keys: readonly Key[]): Animated =>
  keys.map((k) =>
    k.ease === "linear"
      ? ([k.t, k.v] as [number, number])
      : { t: k.t, v: k.v, ease: k.ease },
  );

// The keys that still shape [lo, hi]: those inside it, plus the nearest one beyond each edge.
function prune(keys: readonly Key[], lo: number, hi: number): Key[] {
  const before = keys.filter((k) => k.t < lo).at(-1);
  const after = keys.find((k) => k.t > hi);
  const inside = keys.filter((k) => k.t >= lo && k.t <= hi);
  return [...(before ? [before] : []), ...inside, ...(after ? [after] : [])];
}

/** `animate` cut at `at` seconds into the shot, `length` its whole span: EXACT, the tail being the same keys shifted. */
// Shifted rather than resampled, so an eased segment across the cut plays on unchanged in both halves.
export function splitAnimate(
  animate: Animate,
  at: number,
  length: number,
): { head: Animate; tail: Animate } {
  const head: Animate = {};
  const tail: Animate = {};
  const end = length > 0 ? length : Number.POSITIVE_INFINITY;
  for (const p of ANIMATED_PROPS) {
    const a = animate[p];
    if (a === undefined) continue;
    if (typeof a === "number") {
      head[p] = a;
      tail[p] = a;
      continue;
    }
    const keys = keysOf(a);
    head[p] = written(prune(keys, 0, at));
    tail[p] = written(
      prune(keys, at, end).map((k) => ({
        ...k,
        t: Math.round((k.t - at) * 1000) / 1000,
      })),
    );
  }
  return { head, tail };
}
