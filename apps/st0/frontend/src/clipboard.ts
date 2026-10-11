// clipboard.ts — what `selection copy` puts aside and `selection paste` puts down: a
// rectangle's contents, in coordinates RELATIVE to its top-left corner. Pure, so the offset
// arithmetic that decides where a paste lands can be pinned without a project. See
// apps/st0/frontend/docs/clipEditors.md.

/** One copied note. `t` is beats from the rectangle's left edge, `k` semitones below its top row. */
export interface CopiedNote {
  k: number;
  t: number;
  d: number;
  v?: number;
  // A PAD's effects ride along, for the reason an event's window does: a copy is of the thing you copied.
  repeat?: number;
  skip?: number;
}

/** One copied event: `row` and `start` from the rectangle's corner, then the placement's OWN words, carried whole. */
export interface CopiedEvent {
  row: number;
  ref: string;
  start: number;
  /** The window into the material: seconds for a clip, a timecode for a sequence. As authored. */
  from?: number | string;
  to?: number | string;
  fadeIn?: string;
  fadeOut?: string;
  loop?: number;
  disabled?: boolean;
  warp?: boolean;
}

/** The placement fields a copy carries beside `ref`/`start` — the shape `WebClip.event` has. */
export interface EventAttrs {
  from?: number | string;
  to?: number | string;
  fadeIn?: string;
  fadeOut?: string;
  loop?: number;
  disabled?: boolean;
  warp?: boolean;
}

/** The authored fields worth carrying, rebuilt key by key: a wholesale spread would carry a newer producer's field into an `events add`. */
function attrsOf(e: EventAttrs | undefined): EventAttrs {
  if (!e) return {};
  return {
    ...(e.from !== undefined ? { from: e.from } : {}),
    ...(e.to !== undefined ? { to: e.to } : {}),
    ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}),
    ...(e.fadeOut ? { fadeOut: e.fadeOut } : {}),
    ...(e.loop && e.loop > 1 ? { loop: e.loop } : {}),
    ...(e.disabled ? { disabled: true } : {}),
    ...(e.warp === false ? { warp: false } : {}),
  };
}

/** The shell's one clipboard, holding either kind — one slot, and the wrong KIND refused by name rather than coerced. */
export type Clipboard =
  | {
      kind: "notes";
      /** The sequence it came from, named so a paste can say when it is landing somewhere else. */
      sequence: string;
      notes: CopiedNote[];
      /** The rectangle's own size, for the status line and for a paste's bounds check. */
      keys: number;
      beats: number;
      /** The rectangle's top KEY, so a roll's paste can put each note back on its own pitch. */
      top: number;
    }
  | {
      kind: "events";
      events: CopiedEvent[];
      rows: number;
      beats: number;
    };

/** Nothing to put down — an empty rectangle copies as `null` rather than as an empty clipboard. */
export type MaybeClipboard = Clipboard | null;

/** What a rectangle HOLDS — a note is in when it STARTS inside; exported so copying and deleting cannot disagree (docs/clipEditors.md). */
export function notesInRegion<T extends { key: number; time: number }>(
  notes: readonly T[],
  loKey: number,
  hiKey: number,
  from: number,
  to: number,
): T[] {
  return notes.filter(
    (n) =>
      n.key >= loKey &&
      n.key <= hiKey &&
      n.time >= from - 1e-9 &&
      n.time < to - 1e-9,
  );
}

/** The notes inside the rectangle, relative to its corner: a note is IN when it STARTS inside, and its length is carried uncut. */
export function copyNotes(
  notes: readonly {
    key: number;
    time: number;
    duration: number;
    vel?: number;
    repeat?: number;
    skip?: number;
  }[],
  sequence: string,
  loKey: number,
  hiKey: number,
  from: number,
  to: number,
): MaybeClipboard {
  const inside = notesInRegion(notes, loKey, hiKey, from, to);
  if (!inside.length) return null;
  return {
    kind: "notes",
    sequence,
    keys: hiKey - loKey + 1,
    beats: to - from,
    top: hiKey,
    notes: inside.map((n) => ({
      k: hiKey - n.key, // rows DOWN from the top, so a paste offsets one way on both axes
      t: n.time - from,
      d: n.duration,
      ...(n.vel === undefined || n.vel === 1 ? {} : { v: n.vel }),
      ...(n.repeat ? { repeat: n.repeat } : {}),
      ...(n.skip ? { skip: n.skip } : {}),
    })),
  };
}

/** …and back out at a caret: the rectangle's top-left lands under it, and anything pushed off the keyboard is DROPPED, not clamped. */
export function pasteNotes(
  clip: Clipboard,
  topKey: number,
  at: number,
): {
  t: number;
  d: number;
  k: number;
  v?: number;
  repeat?: number;
  skip?: number;
}[] {
  if (clip.kind !== "notes") return [];
  return clip.notes
    .map((n) => ({
      k: topKey - n.k,
      t: at + n.t,
      d: n.d,
      ...(n.v === undefined ? {} : { v: n.v }),
      // Unchanged by the offset: `repeat` counts inside the note's own duration and `skip` counts passes.
      ...(n.repeat ? { repeat: n.repeat } : {}),
      ...(n.skip ? { skip: n.skip } : {}),
    }))
    .filter((n) => n.k >= 0 && n.k <= 127 && n.t >= 0);
}

/** The events inside a rectangle of lanes × beats, relative to its corner — taken by START like the notes, and for the same reason. */
export function copyEvents(
  rows: readonly {
    events: readonly { ref: string; start: number; event?: EventAttrs }[];
  }[],
  from: number,
  to: number,
): MaybeClipboard {
  const events: CopiedEvent[] = [];
  for (const [row, lane] of rows.entries())
    for (const e of lane.events)
      if (e.start >= from - 1e-9 && e.start < to - 1e-9)
        events.push({
          row,
          ref: e.ref,
          start: e.start - from,
          ...attrsOf(e.event),
        });
  if (!events.length) return null;
  return { kind: "events", events, rows: rows.length, beats: to - from };
}

/** …and back out onto real lanes: as many as the paste can reach, the rest dropped rather than folded onto the last one. */
export function pasteEvents(
  clip: Clipboard,
  lanes: readonly string[],
  at: number,
): ({ track: string; ref: string; start: number } & EventAttrs)[] {
  if (clip.kind !== "events") return [];
  return clip.events.flatMap((e) => {
    const track = lanes[e.row];
    if (!track) return [];
    const start = at + e.start;
    if (start < 0) return [];
    // The window and the fades ride along UNCHANGED while only `start` moves: they measure into the material, not the arrangement.
    return [{ track, ref: e.ref, start, ...attrsOf(e) }];
  });
}

/** How many of a paste's items would be dropped for not fitting — what the status line reports. */
export function droppedCount(kept: number, clip: Clipboard): number {
  const total = clip.kind === "notes" ? clip.notes.length : clip.events.length;
  return Math.max(0, total - kept);
}
