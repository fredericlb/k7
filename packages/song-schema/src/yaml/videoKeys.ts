// videoKeys.ts — set and remove one KEY of a shot's `animate:` in a video track's text, by the
// placement's index and in seconds from the shot's own start. Surgical like videoTrackFile.ts:
// only the placement's `animate:` is rewritten. A lone key at 0 is written back as the constant
// it means. See packages/song-video/docs/animation.md.

import { isSeq, parseDocument } from "yaml";
import {
  type Animate,
  type AnimatedProp,
  AnimateSchema,
  type Ease,
  type Key,
  keysOf,
} from "../keyframes";

const OPTS = { version: "1.2" as const, lineWidth: 0 };

// A collection comes back from `getIn` as a YAML node; the schema reads plain values.
const plain = (v: unknown): unknown =>
  v && typeof v === "object" && "toJSON" in v
    ? (v as { toJSON(): unknown }).toJSON()
    : v;

type Doc = ReturnType<typeof parseDocument>;
type Keys = Partial<Record<AnimatedProp, Key[]>>;

// The placement's `animate:` as plain keys per property, or an empty map when it states none.
function keysAt(doc: Doc, index: number): Keys {
  const parsed = AnimateSchema.safeParse(
    plain(doc.getIn(["events", index, "animate"])),
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

// Keys back in the file's spelling, the whole `animate:` dropped when no property is left.
function write(doc: Doc, index: number, keys: Keys): string {
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
    doc.setIn(
      ["events", index, "animate"],
      doc.createNode(out, { flow: true }),
    );
  else doc.deleteIn(["events", index, "animate"]);
  return doc.toString({ lineWidth: 0 });
}

const ms = (t: number) => Math.round(t * 1000) / 1000;

/** Set one key of the placement at `index`, `t` seconds into the SHOT, replacing one already there; null with no such placement. */
export function setVideoKeyAt(
  text: string,
  index: number,
  prop: AnimatedProp,
  t: number,
  v: number,
  ease: Ease = "linear",
): string | null {
  let doc: Doc;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return null;
  }
  const events = doc.getIn(["events"]);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return null;
  const keys = keysAt(doc, index);
  const at = ms(t);
  // A constant is a key at the shot's start, so it still holds before the one being added.
  const rest = (keys[prop] ?? []).filter((k) => Math.abs(k.t - at) > 5e-4);
  keys[prop] = [...rest, { t: at, v, ease }].sort((p, q) => p.t - q.t);
  return write(doc, index, keys);
}

/** Remove the key of `prop` at `t` seconds into the shot; null when there is none there. */
export function removeVideoKeyAt(
  text: string,
  index: number,
  prop: AnimatedProp,
  t: number,
): string | null {
  let doc: Doc;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return null;
  }
  const keys = keysAt(doc, index);
  const list = keys[prop] ?? [];
  const kept = list.filter((k) => Math.abs(k.t - ms(t)) > 5e-4);
  if (kept.length === list.length) return null;
  keys[prop] = kept;
  return write(doc, index, keys);
}
