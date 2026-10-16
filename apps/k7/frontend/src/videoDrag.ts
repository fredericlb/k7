// videoDrag.ts — a picture placement dragged on the timeline, as arithmetic: where the shot goes,
// what a finished drag writes, and whether it moved at all. In SECONDS throughout, since a picture
// lane is placed on the clock rather than the bar grid. See ../docs/picture.md.

/** One field of a picture placement, in seconds, by INDEX in `events:` — the only unique address (song-video/docs/shapes.md). */
export interface VideoEdit {
  index: number;
  field: "start" | "source_from" | "length";
  value: number;
}

/** Below this a gesture is a click, not a drag — the same 4px the ruler's gestures use. */
export const DRAG_SLOP = 4;

// The shortest shot a drag may leave, in seconds: `length: 0` already MEANS 'to the end of the source'.
const V_MIN = 0.04;
// Seconds drawn for a `length: 0` placement, whose real extent needs the source opened to know.
export const V_NATURAL = 4;

/** A picture placement in hand, in seconds throughout; `pxPerSec` and the ticks are captured at the GRAB, so a zoom mid-drag cannot slide the shot. */
export interface VDrag {
  trackId: string;
  index: number; // its place in the lane's `events:` — see VideoEdit
  // An event with no `ref`: a span saying the lane is ON, with no source to trim (docs/shapes.md).
  activation: boolean;
  // Where the press landed: the body moves the shot, an edge trims it. See docs/picture.md.
  mode: "move" | "in" | "out";
  origStart: number;
  origLength: number; // 0 == to the end of the source
  origFrom: number;
  /** How fast the source runs under the shot, signed; absent is 1 — what a head trim multiplies (song-video/docs/speed.md). */
  speed?: number;
  start: number; // live
  length: number; // live; still 0 while a length-0 placement is only being moved
  x: number; // pointer x at grab
  pxPerSec: number;
  moved: boolean;
  pending?: boolean; // written, still drawn until the reload — as Move.pending is
}

/** The extent a placement is DRAWN at: its own, or the placeholder a length-0 shot gets. */
const drawnLength = (length: number): number =>
  length > 0 ? length : V_NATURAL;

/** Where a picture drag puts the shot, in seconds — pure, so its tests need no component mounted. */
export function videoDragTo(
  v: Pick<
    VDrag,
    | "mode"
    | "origStart"
    | "origLength"
    | "origFrom"
    | "start"
    | "length"
    | "speed"
  >,
  deltaSec: number,
  snapSec: (sec: number) => number,
): { start: number; length: number } {
  const drawn = drawnLength(v.origLength);
  if (v.mode === "move")
    return { start: snapSec(v.origStart + deltaSec), length: v.length };
  if (v.mode === "in") {
    // The head follows the pointer and the in-point the head; forwards, the head cannot pass the source's first frame.
    const speed = v.speed ?? 1;
    const floor =
      speed > 0 ? v.origStart - v.origFrom / speed : Number.NEGATIVE_INFINITY;
    const start = Math.max(
      Math.min(snapSec(v.origStart + deltaSec), v.origStart + drawn - V_MIN),
      floor,
    );
    return { start, length: drawn - (start - v.origStart) };
  }
  const end = Math.max(
    snapSec(v.origStart + drawn + deltaSec),
    v.origStart + V_MIN,
  );
  return { start: v.start, length: end - v.origStart };
}

/** The fields a finished picture drag writes, in SECONDS — the left edge writes three, and each is load-bearing (docs/picture.md). */
export function videoDragEdits(v: VDrag): VideoEdit[] {
  if (v.mode === "out")
    return [{ index: v.index, field: "length", value: v.length }];
  const edits: VideoEdit[] = [
    { index: v.index, field: "start", value: v.start },
  ];
  if (v.mode === "in") {
    const delta = v.start - v.origStart;
    // An ACTIVATION has no source: its left edge moves the start and leaves the end where it was.
    if (!v.activation)
      edits.push({
        index: v.index,
        field: "source_from",
        value: Math.max(0, v.origFrom + delta * (v.speed ?? 1)),
      });
    edits.push({
      index: v.index,
      field: "length",
      value: Math.max(V_MIN, v.length),
    });
  }
  return edits;
}

/** Whether a finished drag left the placement exactly where it was — then nothing is written. */
export function videoDragIsStill(v: VDrag): boolean {
  return (
    v.start === v.origStart &&
    (v.mode !== "out" || v.length === drawnLength(v.origLength))
  );
}
