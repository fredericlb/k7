// clipboard.ts — what `ui copy` puts aside and `paste` puts down: a rectangle's contents, in
// coordinates RELATIVE to its top-left corner. Pure, so the offset arithmetic that decides where a
// paste lands can be pinned without a project. See apps/st0/frontend/docs/clipEditors.md.

/** One copied note. `t` is beats from the rectangle's left edge, `k` semitones below its top row. */
export interface CopiedNote {
  k: number;
  t: number;
  d: number;
  v?: number;
}

/** One copied event. `row` is lanes below the rectangle's top, `start` beats from its left edge. */
export interface CopiedEvent {
  row: number;
  ref: string;
  start: number;
  loop?: number;
}

/**
 * The shell's one clipboard, holding either kind.
 *
 * One slot rather than one per surface: copying is a single gesture with a single memory, and two
 * clipboards would make "what does paste put down" a question about which pane you copied from
 * three minutes ago. Pasting the wrong KIND is refused by name instead — notes into an arrangement
 * is not a coercion anybody wants guessed at.
 */
export type Clipboard =
  | {
      kind: "notes";
      /** The sequence it came from, named so a paste can say when it is landing somewhere else. */
      sequence: string;
      notes: CopiedNote[];
      /** The rectangle's own size, for the status line and for a paste's bounds check. */
      keys: number;
      beats: number;
    }
  | {
      kind: "events";
      events: CopiedEvent[];
      rows: number;
      beats: number;
    };

/** Nothing to put down — an empty rectangle copies as `null` rather than as an empty clipboard. */
export type MaybeClipboard = Clipboard | null;

/**
 * The notes inside `[loKey..hiKey] × [from, to)`, relative to that corner.
 *
 * A note is IN when it STARTS inside — the rule `stepGrid`'s cells already follow, and the only
 * one that makes a rectangle's contents well defined: a note crossing the right edge belongs to
 * the beat it begins on, and taking it by overlap instead would copy the same note into two
 * adjacent rectangles.
 *
 * Its length is carried whole, uncut. A copy is of the MATERIAL, and a note trimmed to the
 * rectangle would come back shorter than the one you selected — the rectangle says which notes,
 * not how long they are.
 */
export function copyNotes(
  notes: readonly {
    key: number;
    time: number;
    duration: number;
    vel?: number;
  }[],
  sequence: string,
  loKey: number,
  hiKey: number,
  from: number,
  to: number,
): MaybeClipboard {
  const inside = notes.filter(
    (n) =>
      n.key >= loKey &&
      n.key <= hiKey &&
      n.time >= from - 1e-9 &&
      n.time < to - 1e-9,
  );
  if (!inside.length) return null;
  return {
    kind: "notes",
    sequence,
    keys: hiKey - loKey + 1,
    beats: to - from,
    notes: inside.map((n) => ({
      k: hiKey - n.key, // rows DOWN from the top, so a paste offsets one way on both axes
      t: n.time - from,
      d: n.duration,
      ...(n.vel === undefined || n.vel === 1 ? {} : { v: n.vel }),
    })),
  };
}

/**
 * …and back out, at a caret: absolute notes for `sequence note add`.
 *
 * `topKey` is the pitch of the caret's row and `at` its beat, so what was the rectangle's top-left
 * lands exactly under the caret. Anything the offset pushes off the keyboard is DROPPED rather
 * than clamped: a chord squashed onto key 0 is not the chord you copied, and a silently
 * transposed note is worse than a missing one. The caller reports the count.
 */
export function pasteNotes(
  clip: Clipboard,
  topKey: number,
  at: number,
): { t: number; d: number; k: number; v?: number }[] {
  if (clip.kind !== "notes") return [];
  return clip.notes
    .map((n) => ({
      k: topKey - n.k,
      t: at + n.t,
      d: n.d,
      ...(n.v === undefined ? {} : { v: n.v }),
    }))
    .filter((n) => n.k >= 0 && n.k <= 127 && n.t >= 0);
}

/**
 * The events inside a rectangle of lanes × beats, relative to its corner.
 *
 * `rows` is the lanes the rectangle covers, top first, each with the placements it holds. Taken by
 * START like the notes, and for the same reason.
 */
export function copyEvents(
  rows: readonly {
    events: readonly { ref: string; start: number; loop?: number }[];
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
          ...(e.loop && e.loop > 1 ? { loop: e.loop } : {}),
        });
  if (!events.length) return null;
  return { kind: "events", events, rows: rows.length, beats: to - from };
}

/**
 * …and back out onto real lanes: the payload `events add` takes.
 *
 * `lanes` is the tracks from the caret's row DOWNWARDS — as many as the paste can reach. A
 * rectangle three lanes tall pasted onto the last lane has nowhere to put its lower two, and they
 * are dropped rather than folded onto the last one: stacking material nobody asked to stack is a
 * worse answer than putting down what fits and saying so.
 */
export function pasteEvents(
  clip: Clipboard,
  lanes: readonly string[],
  at: number,
): { track: string; ref: string; start: number; loop?: number }[] {
  if (clip.kind !== "events") return [];
  return clip.events.flatMap((e) => {
    const track = lanes[e.row];
    if (!track) return [];
    const start = at + e.start;
    if (start < 0) return [];
    return [{ track, ref: e.ref, start, ...(e.loop ? { loop: e.loop } : {}) }];
  });
}

/** How many of a paste's items would be dropped for not fitting — what the status line reports. */
export function droppedCount(kept: number, clip: Clipboard): number {
  const total = clip.kind === "notes" ? clip.notes.length : clip.events.length;
  return Math.max(0, total - kept);
}
