// videoTrackFile.ts — read and edit a video track's `events:` list, each placement
// `{ref, start, length, source_from}` in DECIMAL SECONDS. A SURGICAL text rewrite, like every
// other file editor here (trackFile.ts, sequenceFile.ts): these files carry the comments that
// document the format, and a round trip through the serialiser would delete every one of them.
// Browser-safe, because the editor's readers strip edits a buffer that has not been saved yet.
// Two ways in: by INDEX, which the drag and the verbs use, and by REF for the editor's readers.

import { isSeq, parseDocument } from "yaml";
import {
  type Animate,
  AnimateSchema,
  keysOf,
  splitAnimate,
} from "../keyframes";

export interface VideoPlacement {
  /** The `ref:` value — a clips/ id whose source is a video file. EMPTY on an ACTIVATION, an
   *  event that names none and says only WHEN its lane is on (song-video/docs/shapes.md). */
  ref: string;
  start: number;
  length: number;
  sourceFrom: number;
  /** How fast its source runs, signed — present only when the file states one (song-video docs/speed.md). */
  speed?: number;
}

const OPTS = { version: "1.2" as const, lineWidth: 0 };

// A collection comes back from `getIn` as a YAML node; the schemas read plain values.
const plain = (v: unknown): unknown =>
  v && typeof v === "object" && "toJSON" in v
    ? (v as { toJSON(): unknown }).toJSON()
    : v;

const num = (v: unknown, dflt = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/** The placements a video track declares, in file order. */
export function listVideoPlacements(text: string): VideoPlacement[] {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return []; // a half-typed file has no placements to show yet
  }
  const clips = doc.getIn(["events"]);
  if (!isSeq(clips)) return [];
  const out: VideoPlacement[] = [];
  // Every entry, INCLUDING the ref-less ones: the list's indices are `events:`'s, and a caller
  // that writes by index (the verbs, the timeline's drag) would address the wrong line otherwise.
  clips.items.forEach((_item, i) => {
    const ref = doc.getIn(["events", i, "ref"]);
    out.push({
      ref: typeof ref === "string" ? ref : "",
      start: num(doc.getIn(["events", i, "start"])),
      length: num(doc.getIn(["events", i, "length"])),
      sourceFrom: num(doc.getIn(["events", i, "source_from"])),
      ...(doc.getIn(["events", i, "speed"]) != null
        ? { speed: num(doc.getIn(["events", i, "speed"]), 1) }
        : {}),
    });
  });
  return out;
}

/** Set (or clear) the lane's `mute:` — HIDDEN, there being no sound on a picture lane. */
export function setVideoLaneMute(text: string, mute: boolean): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  // Removed rather than written `false`: absent already means audible, and a file says what is unusual.
  if (mute) doc.setIn(["mute"], true);
  else doc.deleteIn(["mute"]);
  return doc.toString({ lineWidth: 0 });
}

/** Set the LANE's own rect — x/y/w/h, top-level keys, in viewport px (packages/song-video/docs/picture.md). */
export function setVideoLaneRect(
  text: string,
  rect: { x: number; y: number; w: number; h: number },
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  // All four, always: a lane stating three of them and inheriting the fourth is a rect nobody can read.
  for (const k of ["x", "y", "w", "h"] as const)
    doc.setIn([k], Math.round(rect[k]));
  return doc.toString({ lineWidth: 0 });
}

/** Set one numeric field of the placement whose `ref` is `ref` — by REF and not by index, since a drag grabbed a strip. */
export function setVideoPlacementField(
  text: string,
  ref: string,
  field: "source_from" | "length" | "start",
  value: number,
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const clips = doc.getIn(["events"]);
  if (!isSeq(clips)) return text;
  const at = clips.items.findIndex(
    (_item, i) => doc.getIn(["events", i, "ref"]) === ref,
  );
  if (at < 0) return text;
  // Rounded to milliseconds: a drag's float noise doesn't belong in the file, and cutting needs no more.
  doc.setIn(["events", at, field], Math.round(value * 1000) / 1000);
  return doc.toString({ lineWidth: 0 });
}

/** Set one numeric field of the placement at `index`. By POSITION, so a ref placed twice is still two placements. */
export function setVideoPlacementFieldAt(
  text: string,
  index: number,
  field: "source_from" | "length" | "start",
  value: number,
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const events = doc.getIn(["events"]);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return text;
  // The same millisecond rounding the drag writes, so a verb and a gesture leave the same bytes.
  doc.setIn(["events", index, field], Math.round(value * 1000) / 1000);
  return doc.toString({ lineWidth: 0 });
}

/** Set the placement's `speed:`, signed — or drop the key at 1, which is what absent already means. */
export function setVideoSpeedAt(
  text: string,
  index: number,
  speed: number,
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const events = doc.getIn(["events"]);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return text;
  if (Math.abs(speed - 1) < 1e-9) doc.deleteIn(["events", index, "speed"]);
  else doc.setIn(["events", index, "speed"], Math.round(speed * 10000) / 10000);
  return doc.toString({ lineWidth: 0 });
}

/** Drop the placement at `index`, or the text unchanged when there is none there. */
export function removeVideoPlacementAt(text: string, index: number): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const events = doc.getIn(["events"]);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return text;
  events.items.splice(index, 1);
  return doc.toString({ lineWidth: 0 });
}

/** Cut the placement at `index` in two at `cut` seconds, the tail inserted RIGHT AFTER it; null when the cut is not inside it. */
// After, not appended: file order decides which shot covers which (song-video docs/transitions.md).
export function splitVideoPlacementAt(
  text: string,
  index: number,
  cut: number,
): string | null {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return null;
  }
  const events = doc.getIn(["events"]);
  if (!isSeq(events) || index < 0 || index >= events.items.length) return null;
  const at = (i: number, key: string) => doc.getIn(["events", i, key]);
  const start = num(at(index, "start"));
  const length = num(at(index, "length"));
  // The picture's own interval rule: a length, else the next entry's start, else open-ended.
  const next =
    index + 1 < events.items.length
      ? num(at(index + 1, "start"))
      : Number.POSITIVE_INFINITY;
  const end = length > 0 ? start + length : next;
  const ms = (n: number) => Math.round(n * 1000) / 1000;
  if (!(ms(cut) > start && ms(cut) < end)) return null;
  const head = ms(cut) - start;
  const tail = doc.createNode(
    (events.items[index] as { toJSON(): unknown }).toJSON(),
  ) as typeof events;
  tail.flow = (events.items[index] as { flow?: boolean }).flow ?? true;
  events.items.splice(index + 1, 0, tail);
  // The head keeps how the shot ARRIVES, the tail how it LEAVES; a cut between them is a plain cut.
  doc.setIn(["events", index, "length"], ms(head));
  doc.deleteIn(["events", index, "fade_out"]);
  doc.setIn(["events", index + 1, "start"], ms(cut));
  doc.setIn(
    ["events", index + 1, "length"],
    length > 0 ? ms(length - head) : 0,
  );
  doc.deleteIn(["events", index + 1, "fade_in"]);
  // The animation is cut EXACTLY, each half playing what the shot played over its span (keyframes.ts).
  const animate = AnimateSchema.safeParse(plain(at(index, "animate")));
  if (animate.success) {
    const halves = splitAnimate(animate.data, head, length);
    doc.setIn(
      ["events", index, "animate"],
      doc.createNode(halves.head, { flow: true }),
    );
    doc.setIn(
      ["events", index + 1, "animate"],
      doc.createNode(halves.tail, { flow: true }),
    );
  }
  // An ACTIVATION has no source to trim into, and its schema refuses the key.
  if (typeof at(index, "ref") === "string")
    doc.setIn(
      ["events", index + 1, "source_from"],
      // The source runs at the shot's SPEED, so the head consumed head × speed of it (song-video docs/speed.md).
      ms(num(at(index, "source_from")) + head * num(at(index, "speed"), 1)),
    );
  return doc.toString({ lineWidth: 0 });
}

/** Append a placement, creating `events:` when the lane has none. */
export function addVideoPlacement(
  text: string,
  p: VideoPlacement,
): string | null {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return null; // a half-typed lane is not one to append to
  }
  const ms = (n: number) => Math.round(n * 1000) / 1000;
  const entry: Record<string, string | number> = {
    ref: p.ref,
    start: ms(p.start),
    length: ms(p.length),
  };
  if (p.sourceFrom) entry.source_from = ms(p.sourceFrom);
  const events = doc.getIn(["events"]);
  if (!isSeq(events)) {
    // No `events:` at all, or one holding something else — only the absent case is ours to create.
    if (events !== undefined && events !== null) return null;
    doc.setIn(["events"], [entry]);
    return doc.toString({ lineWidth: 0 });
  }
  doc.addIn(["events"], entry);
  return doc.toString({ lineWidth: 0 });
}

/** Insert or delete seconds on a video lane, by INDEX since a ref may be placed twice — the lanes' rule otherwise. */
export function spliceVideoTime(
  text: string,
  atSeconds: number,
  lenSeconds: number,
  mode: "insert" | "delete",
): { text: string; moved: number; removed: number } {
  let doc: ReturnType<typeof parseDocument>;
  let moved = 0;
  let removed = 0;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return { text, moved, removed }; // a half-typed file is left exactly as it is
  }
  const events = doc.getIn(["events"]);
  if (!(lenSeconds > 0) || !isSeq(events)) return { text, moved, removed };
  const end = atSeconds + lenSeconds;
  // Descending, so removing one does not shift the address of the next.
  for (let i = events.items.length - 1; i >= 0; i--) {
    const start = num(doc.getIn(["events", i, "start"]));
    if (mode === "delete" && start >= atSeconds - 1e-6 && start < end - 1e-6) {
      events.items.splice(i, 1);
      removed++;
      continue;
    }
    const from = mode === "delete" ? end : atSeconds;
    if (start < from - 1e-6) continue;
    const next = start + (mode === "delete" ? -lenSeconds : lenSeconds);
    // Milliseconds, the same rounding a drag writes, so a round trip compares byte for byte.
    doc.setIn(["events", i, "start"], Math.round(next * 1000) / 1000);
    moved++;
  }
  if (!moved && !removed) return { text, moved, removed };
  return { text: doc.toString({ lineWidth: 0 }), moved, removed };
}

/** Shift the keys of the placement at `index` by `-delta` seconds, so a trimmed head keeps its animation on the same frames. */
export function shiftVideoAnimationAt(
  text: string,
  index: number,
  delta: number,
): string {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, OPTS);
  } catch {
    return text;
  }
  const parsed = AnimateSchema.safeParse(
    plain(doc.getIn(["events", index, "animate"])),
  );
  if (!parsed.success || !delta) return text;
  const shifted: Animate = {};
  for (const [prop, a] of Object.entries(parsed.data) as [
    keyof Animate,
    Animate[keyof Animate],
  ][]) {
    if (a === undefined) continue;
    shifted[prop] =
      typeof a === "number"
        ? a
        : keysOf(a).map((k) => {
            const t = Math.round((k.t - delta) * 1000) / 1000;
            return k.ease === "linear"
              ? ([t, k.v] as [number, number])
              : { t, v: k.v, ease: k.ease };
          });
  }
  doc.setIn(
    ["events", index, "animate"],
    doc.createNode(shifted, { flow: true }),
  );
  return doc.toString({ lineWidth: 0 });
}
