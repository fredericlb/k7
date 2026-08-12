import { describe, expect, it } from "vitest";
import {
  videoDragEdits,
  videoDragIsStill,
  videoDragTo,
} from "./components/TimelineTab";

// The three drags a picture placement takes, as arithmetic. Nothing in this app mounts a
// component, so what a gesture puts IN A FILE is the part a test can reach — and every case
// below is one where a wrong answer is invisible on screen until the reload.
// See docs/picture.md.

/** No snapping: these are about the maths, not about the ruler that feeds it. */
const free = (sec: number) => Math.max(0, sec);
/** Snap to whole seconds, standing in for whatever the ruler happens to be drawing. */
const toSecond = (sec: number) => Math.max(0, Math.round(sec));

const shot = (over: Partial<Parameters<typeof videoDragTo>[0]> = {}) => ({
  mode: "move" as const,
  origStart: 4,
  origLength: 6,
  origFrom: 2,
  start: 4,
  length: 6,
  ...over,
});

const full = (over: Parameters<typeof videoDragEdits>[0] | object = {}) => ({
  trackId: "main",
  ref: "shot_a",
  x: 0,
  pxPerSec: 100,
  moved: true,
  ...shot(),
  ...over,
});

describe("moving a shot", () => {
  it("writes only its start", () => {
    const v = full({ ...shot(), start: 9 });
    expect(videoDragEdits(v)).toEqual([
      { ref: "shot_a", field: "start", value: 9 },
    ]);
  });

  it("cannot be dragged before zero", () => {
    expect(videoDragTo(shot(), -100, free).start).toBe(0);
  });

  it("leaves the extent alone", () => {
    expect(videoDragTo(shot(), 3, free)).toEqual({ start: 7, length: 6 });
  });
});

describe("trimming the head", () => {
  const head = (over = {}) => shot({ mode: "in" as const, ...over });

  it("keeps the TAIL where it is", () => {
    // Writing start and source_from alone would slide the whole shot later instead of
    // shortening it, and the cut after it would move too.
    const next = videoDragTo(head(), 2, free);
    expect(next.start).toBe(6);
    expect(next.length).toBe(4);
    expect(next.start + next.length).toBe(4 + 6); // the tail, unmoved
  });

  it("moves the source's in-point by exactly the same delta", () => {
    // Or the frame under the new edge is not the frame that was there before the trim.
    const v = full({ ...head(), start: 6, length: 4 });
    expect(videoDragEdits(v)).toEqual([
      { ref: "shot_a", field: "start", value: 6 },
      { ref: "shot_a", field: "source_from", value: 4 }, // 2 + 2
      { ref: "shot_a", field: "length", value: 4 },
    ]);
  });

  it("refuses to ask for a frame before the file starts", () => {
    // `source_from` is 2, so the head may come back 2s and no further.
    expect(videoDragTo(head(), -10, free).start).toBe(2);
    const v = full({ ...head(), start: 2, length: 8 });
    expect(videoDragEdits(v).find((e) => e.field === "source_from")).toEqual({
      ref: "shot_a",
      field: "source_from",
      value: 0,
    });
  });

  it("refuses to swallow the tail", () => {
    const next = videoDragTo(head(), 999, free);
    expect(next.length).toBeCloseTo(0.04);
    expect(next.start).toBeCloseTo(4 + 6 - 0.04);
  });

  it("pins the extent of a length-0 shot, which is the same write", () => {
    // A length-0 placement runs to the end of its source, so the trim would be undone on the
    // next compile unless the extent is written too. It needs no special case: the general
    // rule already writes `length`.
    const v0 = head({ origLength: 0, length: 0 });
    const next = videoDragTo(v0, 1, free);
    expect(next).toEqual({ start: 5, length: 3 }); // the 4s placeholder, less the trim
    const edits = videoDragEdits(full({ ...v0, start: 5, length: 3 }));
    expect(edits.map((e) => e.field)).toEqual([
      "start",
      "source_from",
      "length",
    ]);
  });
});

describe("setting the extent", () => {
  const tail = (over = {}) => shot({ mode: "out" as const, ...over });

  it("writes only the length, and never moves the head", () => {
    const next = videoDragTo(tail(), 3, free);
    expect(next).toEqual({ start: 4, length: 9 });
    expect(videoDragEdits(full({ ...tail(), length: 9 }))).toEqual([
      { ref: "shot_a", field: "length", value: 9 },
    ]);
  });

  it("cannot be dragged past its own head", () => {
    expect(videoDragTo(tail(), -999, free).length).toBeCloseTo(0.04);
  });

  it("gives a length-0 shot a real extent, off the drawn placeholder", () => {
    // Until it is dragged the browser has not measured the source, so 4s is what is on screen
    // and 4s is what the drag starts from — anything else would jump under the cursor.
    expect(videoDragTo(tail({ origLength: 0, length: 0 }), 1, free)).toEqual({
      start: 4,
      length: 5,
    });
  });
});

describe("a drag that changed nothing writes nothing", () => {
  it("is still when the head came back to where it was", () => {
    expect(videoDragIsStill(full())).toBe(true);
    expect(videoDragIsStill(full({ ...shot(), start: 5 }))).toBe(false);
  });

  it("is still when the tail returns to where it was — measured against the DRAWN extent", () => {
    // A length-0 shot's live length becomes the 4s placeholder the moment it is dragged, so
    // comparing against `origLength` (0) would call an unmoved tail a change and write 4.
    const back = videoDragTo(
      shot({ mode: "out", origLength: 0, length: 0 }),
      0,
      free,
    );
    expect(
      videoDragIsStill(
        full({ ...shot({ mode: "out", origLength: 0 }), ...back }),
      ),
    ).toBe(true);
  });
});

describe("the ruler's ticks are what it lands on", () => {
  it("snaps the head, in whatever unit the ruler is reading", () => {
    // The snap is a parameter: the timeline passes the beats it actually drew, converted. So
    // switching the ruler to seconds changes where a shot can land without changing this.
    expect(videoDragTo(shot(), 2.4, toSecond).start).toBe(6);
    expect(videoDragTo(shot(), 2.6, toSecond).start).toBe(7);
  });

  it("snaps the TAIL against the shot's end, not its start", () => {
    expect(videoDragTo(shot({ mode: "out" }), 0.4, toSecond).length).toBe(6);
    expect(videoDragTo(shot({ mode: "out" }), 0.6, toSecond).length).toBe(7);
  });
});
