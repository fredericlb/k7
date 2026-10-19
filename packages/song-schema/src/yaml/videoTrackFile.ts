// videoTrackFile.ts — read and edit a video track's `events:` list, each placement `{ref, start, length, source_from}` in DECIMAL SECONDS.
// Every writer edits a K7Scope at the file's root, value by value, so the comments that document the format stay. Browser-safe.
// A reader would get wrong that a refused edit throws: it answers false and leaves the file alone, as does an unreadable buffer.
// Two ways in: by INDEX, which the drag and the verbs use, and by REF for the editor's readers.

import type { K7Scope } from "@studio/k7x/document";
import { K7Document } from "@studio/k7x/document";
import { K7SyntaxError } from "@studio/k7x/parse";
import {
  type Animate,
  AnimateSchema,
  keysOf,
  splitAnimate,
} from "../keyframes";

export interface VideoPlacement {
  /** The `ref:` value — a clips/ id whose source is a video file; EMPTY on an ACTIVATION (song-video/docs/shapes.md). */
  ref: string;
  start: number;
  length: number;
  sourceFrom: number;
  /** How fast its source runs, signed — present only when the file states one (song-video docs/speed.md). */
  speed?: number;
}

type Data = Record<string, unknown>;

const num = (v: unknown, dflt = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

const ms = (n: number) => Math.round(n * 1000) / 1000;

/** The file's data, or null for a buffer that does not read yet — every edit here is then a no-op. */
function dataOf(doc: K7Scope): Data | null {
  try {
    const raw = doc.toJS();
    return raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Data)
      : null;
  } catch (e) {
    if (e instanceof K7SyntaxError) return null;
    throw e;
  }
}

/** The `events:` list as plain values, or null when the file has none or does not read. */
function eventsOf(doc: K7Scope): Data[] | null {
  const events = dataOf(doc)?.events;
  return Array.isArray(events) ? (events as Data[]) : null;
}

const hasIndex = (events: unknown[] | null, index: number): boolean =>
  !!events && index >= 0 && index < events.length;

/** The placements a video track declares, in file order: from k7x text or a document; an unreadable text has none. */
export function listVideoPlacements(
  source: string | K7Scope,
): VideoPlacement[] {
  const doc =
    typeof source === "string" ? new K7Document(source).at([]) : source;
  // Every entry, INCLUDING the ref-less ones: the list's indices are `events:`'s, which a caller writes by.
  return (eventsOf(doc) ?? []).map((e) => {
    const p = e !== null && typeof e === "object" ? e : {};
    return {
      ref: typeof p.ref === "string" ? p.ref : "",
      start: num(p.start),
      length: num(p.length),
      sourceFrom: num(p.source_from),
      ...(p.speed != null ? { speed: num(p.speed, 1) } : {}),
    };
  });
}

/** Set (or clear) the lane's `mute:` — HIDDEN, there being no sound on a picture lane. */
export function setVideoLaneMute(doc: K7Scope, mute: boolean): void {
  if (!dataOf(doc)) return;
  // Removed rather than written `false`: absent already means audible, and a file says what is unusual.
  if (mute) doc.setIn(["mute"], true);
  else doc.deleteIn(["mute"]);
}

/** Set the LANE's own rect — x/y/w/h, top-level keys, in viewport px (packages/song-video/docs/picture.md). */
export function setVideoLaneRect(
  doc: K7Scope,
  rect: { x: number; y: number; w: number; h: number },
): void {
  if (!dataOf(doc)) return;
  // All four, always: a lane stating three of them and inheriting the fourth is a rect nobody can read.
  for (const k of ["x", "y", "w", "h"] as const)
    doc.setIn([k], Math.round(rect[k]));
}

/** Set one numeric field of the placement whose `ref` is `ref` — by REF, since a drag grabbed a strip; false with no such placement. */
export function setVideoPlacementField(
  doc: K7Scope,
  ref: string,
  field: "source_from" | "length" | "start",
  value: number,
): boolean {
  const at = (eventsOf(doc) ?? []).findIndex((e) => e?.ref === ref);
  if (at < 0) return false;
  // Rounded to milliseconds: a drag's float noise doesn't belong in the file, and cutting needs no more.
  doc.setIn(["events", at, field], ms(value));
  return true;
}

/** Set one numeric field of the placement at `index`, by POSITION so a ref placed twice is two; false with none there. */
export function setVideoPlacementFieldAt(
  doc: K7Scope,
  index: number,
  field: "source_from" | "length" | "start",
  value: number,
): boolean {
  if (!hasIndex(eventsOf(doc), index)) return false;
  // The same millisecond rounding the drag writes, so a verb and a gesture leave the same bytes.
  doc.setIn(["events", index, field], ms(value));
  return true;
}

/** Set the placement's `speed:`, signed — or drop the key at 1, which is what absent already means; false with none there. */
export function setVideoSpeedAt(
  doc: K7Scope,
  index: number,
  speed: number,
): boolean {
  if (!hasIndex(eventsOf(doc), index)) return false;
  if (Math.abs(speed - 1) < 1e-9) doc.deleteIn(["events", index, "speed"]);
  else doc.setIn(["events", index, "speed"], Math.round(speed * 10000) / 10000);
  return true;
}

/** Drop the placement at `index`; false when there is none there. */
export function removeVideoPlacementAt(doc: K7Scope, index: number): boolean {
  if (!hasIndex(eventsOf(doc), index)) return false;
  doc.deleteIn(["events", index]);
  return true;
}

/** Cut the placement at `index` in two at `cut` seconds, the tail inserted RIGHT AFTER it; false when the cut is not inside it. */
// After, not appended: file order decides which shot covers which (song-video docs/transitions.md).
export function splitVideoPlacementAt(
  doc: K7Scope,
  index: number,
  cut: number,
): boolean {
  const events = eventsOf(doc);
  if (!events || !hasIndex(events, index)) return false;
  const shot = events[index] ?? {};
  const start = num(shot.start);
  const length = num(shot.length);
  // The picture's own interval rule: a length, else the next entry's start, else open-ended.
  const next =
    index + 1 < events.length
      ? num(events[index + 1]?.start)
      : Number.POSITIVE_INFINITY;
  const end = length > 0 ? start + length : next;
  if (!(ms(cut) > start && ms(cut) < end)) return false;
  const head = ms(cut) - start;
  // The tail is the shot's own source copied, so its layout and comments come along.
  doc.insertSourceIn(
    ["events"],
    index + 1,
    doc.getSource(["events", index]) ?? "{}",
  );
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
  const animate = AnimateSchema.safeParse(shot.animate);
  if (animate.success) {
    const halves = splitAnimate(animate.data, head, length);
    doc.setIn(["events", index, "animate"], halves.head, { inline: true });
    doc.setIn(["events", index + 1, "animate"], halves.tail, { inline: true });
  }
  // An ACTIVATION has no source to trim into, and its schema refuses the key.
  if (typeof shot.ref === "string")
    doc.setIn(
      ["events", index + 1, "source_from"],
      // The source runs at the shot's SPEED, so the head consumed head × speed of it (song-video docs/speed.md).
      ms(num(shot.source_from) + head * num(shot.speed, 1)),
    );
  return true;
}

/** Append a placement, creating `events:` when the lane has none; false when `events:` holds something else or the file does not read. */
export function addVideoPlacement(doc: K7Scope, p: VideoPlacement): boolean {
  const data = dataOf(doc);
  if (!data) return false;
  const entry: Record<string, string | number> = {
    ref: p.ref,
    start: ms(p.start),
    length: ms(p.length),
  };
  if (p.sourceFrom) entry.source_from = ms(p.sourceFrom);
  const events = data.events;
  if (Array.isArray(events)) {
    doc.addIn(["events"], entry, { inline: true });
    return true;
  }
  // No `events:` at all, or one holding something else — only the absent case is ours to create.
  if (events !== undefined && events !== null) return false;
  doc.setIn(["events"], [entry]);
  return true;
}

/** Insert or delete seconds on a video lane, by INDEX since a ref may be placed twice — the lanes' rule otherwise. */
export function spliceVideoTime(
  doc: K7Scope,
  atSeconds: number,
  lenSeconds: number,
  mode: "insert" | "delete",
): { moved: number; removed: number } {
  let moved = 0;
  let removed = 0;
  const events = eventsOf(doc);
  if (!(lenSeconds > 0) || !events) return { moved, removed };
  const end = atSeconds + lenSeconds;
  // Descending, so removing one does not shift the address of the next.
  for (let i = events.length - 1; i >= 0; i--) {
    const start = num(events[i]?.start);
    if (mode === "delete" && start >= atSeconds - 1e-6 && start < end - 1e-6) {
      doc.deleteIn(["events", i]);
      removed++;
      continue;
    }
    const from = mode === "delete" ? end : atSeconds;
    if (start < from - 1e-6) continue;
    const next = start + (mode === "delete" ? -lenSeconds : lenSeconds);
    // Milliseconds, the same rounding a drag writes, so a round trip compares byte for byte.
    doc.setIn(["events", i, "start"], ms(next));
    moved++;
  }
  return { moved, removed };
}

/** Shift the keys of the placement at `index` by `-delta` seconds, so a trimmed head keeps its animation; false when it has none. */
export function shiftVideoAnimationAt(
  doc: K7Scope,
  index: number,
  delta: number,
): boolean {
  const events = eventsOf(doc);
  if (!events || !hasIndex(events, index)) return false;
  const parsed = AnimateSchema.safeParse(events[index]?.animate);
  if (!parsed.success || !delta) return false;
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
            const t = ms(k.t - delta);
            return k.ease === "linear"
              ? ([t, k.v] as [number, number])
              : { t, v: k.v, ease: k.ease };
          });
  }
  doc.setIn(["events", index, "animate"], shifted, { inline: true });
  return true;
}

/** Rename the STRETCH each fade's `chain:` names, by `renames`; false when none matches. */
export function renameFadeChains(
  doc: K7Scope,
  renames: Readonly<Record<string, string>>,
): boolean {
  let changed = false;
  (eventsOf(doc) ?? []).forEach((e, i) => {
    for (const fade of ["fade_in", "fade_out"]) {
      const f = e?.[fade];
      const was =
        f !== null && typeof f === "object" ? (f as Data).chain : undefined;
      if (typeof was !== "string" || !Object.hasOwn(renames, was)) continue;
      doc.setIn(["events", i, fade, "chain"], renames[was]);
      changed = true;
    }
  });
  return changed;
}
