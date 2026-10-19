// videoKeys.ts — set and remove one KEY of a shot's `animate:` in a video track, by the placement's index and in seconds
// from the shot's own start. Edits a K7Scope at the file's root, and only the placement's `animate:` is rewritten.
// A reader would get wrong that a lone key at 0 stays a key: it is written back as the constant it means.
// See packages/song-video/docs/animation.md.

import type { K7Scope } from "@studio/k7x/document";
import { K7SyntaxError } from "@studio/k7x/parse";
import {
  type Animate,
  type AnimatedProp,
  AnimateSchema,
  type Ease,
  type Key,
  keysOf,
} from "../keyframes";

type Keys = Partial<Record<AnimatedProp, Key[]>>;

/** The `events:` list, or null when the file has none or does not read yet. */
function eventsOf(doc: K7Scope): unknown[] | null {
  try {
    const events = doc.getIn(["events"]);
    return Array.isArray(events) ? events : null;
  } catch (e) {
    if (e instanceof K7SyntaxError) return null;
    throw e;
  }
}

// The placement's `animate:` as plain keys per property, or an empty map when it states none.
function keysAt(doc: K7Scope, index: number): Keys {
  const parsed = AnimateSchema.safeParse(
    doc.getIn(["events", index, "animate"]),
  );
  const out: Keys = {};
  if (!parsed.success) return out;
  for (const [p, a] of Object.entries(parsed.data) as [
    AnimatedProp,
    Animate[AnimatedProp],
  ][])
    if (a !== undefined) out[p] = keysOf(a);
  return out;
}

// Keys back in the file's spelling, on one line, the whole `animate:` dropped when no property is left.
function write(doc: K7Scope, index: number, keys: Keys): void {
  const out: Animate = {};
  for (const [p, ks] of Object.entries(keys) as [AnimatedProp, Key[]][]) {
    const only = ks[0];
    if (!only) continue;
    out[p] =
      ks.length === 1 && only.t === 0 && only.ease === "linear"
        ? only.v
        : ks.map((k) =>
            k.ease === "linear"
              ? ([k.t, k.v] as [number, number])
              : { t: k.t, v: k.v, ease: k.ease },
          );
  }
  if (Object.keys(out).length)
    doc.setIn(["events", index, "animate"], out, { inline: true });
  else doc.deleteIn(["events", index, "animate"]);
}

const ms = (t: number) => Math.round(t * 1000) / 1000;

/** Set one key of the placement at `index`, `t` seconds into the SHOT, replacing one already there; false with no such placement. */
export function setVideoKeyAt(
  doc: K7Scope,
  index: number,
  prop: AnimatedProp,
  t: number,
  v: number,
  ease: Ease = "linear",
): boolean {
  const events = eventsOf(doc);
  if (!events || index < 0 || index >= events.length) return false;
  const keys = keysAt(doc, index);
  const at = ms(t);
  // A constant is a key at the shot's start, so it still holds before the one being added.
  const rest = (keys[prop] ?? []).filter((k) => Math.abs(k.t - at) > 5e-4);
  keys[prop] = [...rest, { t: at, v, ease }].sort((p, q) => p.t - q.t);
  write(doc, index, keys);
  return true;
}

/** Remove the key of `prop` at `t` seconds into the shot; false when there is none there. */
export function removeVideoKeyAt(
  doc: K7Scope,
  index: number,
  prop: AnimatedProp,
  t: number,
): boolean {
  const events = eventsOf(doc);
  if (!events || index < 0 || index >= events.length) return false;
  const keys = keysAt(doc, index);
  const list = keys[prop] ?? [];
  const kept = list.filter((k) => Math.abs(k.t - ms(t)) > 5e-4);
  if (kept.length === list.length) return false;
  keys[prop] = kept;
  write(doc, index, keys);
  return true;
}
