// clipResize.ts — turn "this event should span these two beats" into the fields that model
// actually has: the MATERIAL's window (`from`/`to`) and the placement's `start`/`loop`. A
// placement has no length to set, so a resize is not one number — see docs/clipResize.md.

/** The units a window is written in: seconds into a file, or beats into a sequence's notes. */
export type MaterialKind = "audio" | "sequence";

/** The event as it stands: its window in the MATERIAL's own units, and how many passes it plays. */
export interface ResizeBefore {
  kind: MaterialKind;
  from: number; // 0 when the file says none — the material's start
  to?: number; // absent means "to the end of the source", a length only the engine knows
  loops: number;
  startBeats: number; // where the placement sits on the timeline
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

/**
 * The window and count that make the event span `startBeats..endBeats`.
 *
 * Two cases, and which one applies is decided by `loops`, not by the drag:
 *
 * - **One pass** — the drag sets the WINDOW. Both edges move the material's `from`/`to`, which
 *   is where a clip's extent lives; dragging the left edge trims into the material rather than
 *   sliding it, exactly as it moves the in-point in any DAW.
 * - **Looped** — the drag sets the COUNT and leaves the window alone. A looped clip's length was
 *   a consequence of the repeat (see materialWindow), so lengthening it means another pass, not a
 *   longer window. Rounded to whole passes, because a partial one is not something `loop:` can say.
 *
 * `from` never goes below zero: there is no material before the start of the file. A left edge
 * dragged past it stops there, and the placement's `start` is pulled along so what is left stays
 * under the same beat instead of sliding.
 */
export function resizeToWindow(
  before: ResizeBefore,
  to: ResizeTo,
): ResizeResult {
  const { kind, loops } = before;
  const { tempo } = to;
  const mat = (b: number) => toMaterial(b, kind, tempo);
  const beats = (u: number) => toBeats(u, kind, tempo);

  let startBeats = to.startBeats;
  // The left edge moved by this much, so the window's in-point moves with it.
  let from = before.from + mat(startBeats - before.startBeats);
  if (from < 0) {
    startBeats += beats(-from); // clamped at the material's start; the event keeps its alignment
    from = 0;
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
  return {
    startBeats,
    from: tidy(from),
    to: tidy(from + mat(extent)),
    loops: 1,
  };
}
