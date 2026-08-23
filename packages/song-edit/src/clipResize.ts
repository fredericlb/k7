// clipResize.ts — turn "this event should span these two beats" into the fields that model
// actually has: the MATERIAL's window (`from`/`to`) and the placement's `start`/`loop`. A
// placement has no length to set, so a resize is not one number — see docs/clipResize.md.

/** The units a window is written in: seconds into a file, or beats into a sequence's notes. */
export type MaterialKind = "audio" | "sequence";

/** The event as it stands: its EFFECTIVE window, its pass count, and the cage it may not leave. */
export interface ResizeBefore {
  kind: MaterialKind;
  from: number; // 0 when nothing narrows it — the material's start
  to?: number; // absent means "to the end of the source", a length only the engine knows
  loops: number;
  startBeats: number; // where the placement sits on the timeline
  /** The MATERIAL's window, which the event's is clamped inside; absent means from 0, to unknown. */
  bounds?: { from?: number; to?: number };
}

/** Where the drag put the two edges, on the timeline, in beats. */
export interface ResizeTo {
  startBeats: number;
  endBeats: number;
  tempo: number;
}

/** What to write: the placement's start, and the material's window and pass count. */
export interface ResizeResult {
  startBeats: number;
  from: number;
  to: number;
  loops: number;
}

/** Beats of timeline ↔ the material's own units. A sequence is already in beats; a file is in seconds. */
const toMaterial = (
  beats: number,
  kind: MaterialKind,
  tempo: number,
): number => (kind === "sequence" ? beats : (beats * 60) / tempo);
const toBeats = (units: number, kind: MaterialKind, tempo: number): number =>
  kind === "sequence" ? units : (units * tempo) / 60;

/** Seconds carry float noise from the beat conversion; six places is well under a sample. */
const tidy = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The EVENT's window and count spanning `startBeats..endBeats`, clamped inside `bounds` — packages/song/docs/clipResize.md. */
export function resizeToWindow(
  before: ResizeBefore,
  to: ResizeTo,
): ResizeResult {
  const { kind, loops } = before;
  const { tempo } = to;
  const mat = (b: number) => toMaterial(b, kind, tempo);
  const beats = (u: number) => toBeats(u, kind, tempo);
  const lo = Math.max(0, before.bounds?.from ?? 0);
  const hi = before.bounds?.to;

  let startBeats = to.startBeats;
  // The left edge moved by this much, so the window's in-point moves with it.
  let from = before.from + mat(startBeats - before.startBeats);
  if (from < lo) {
    startBeats += beats(lo - from); // clamped at the material's window; the event keeps its alignment
    from = lo;
  }
  const extent = Math.max(0, to.endBeats - startBeats);

  // A looped event keeps its window and changes how many times it comes round.
  const win = before.to != null ? before.to - before.from : 0;
  if (loops > 1 && win > 0) {
    const passes = Math.max(1, Math.round(extent / beats(win)));
    return {
      startBeats,
      from: tidy(from),
      to: tidy(from + win),
      loops: passes,
    };
  }
  const end = from + mat(extent);
  return {
    startBeats,
    from: tidy(from),
    to: tidy(hi != null ? Math.min(end, hi) : end),
    loops: 1,
  };
}
