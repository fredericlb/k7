import { describe, expect, it } from "vitest";
import {
  dragOffset,
  freeSnap,
  moveOffset,
  snapMode,
  snapPosition,
  snapTo,
} from "./snap";

describe("freeSnap", () => {
  it("is Ctrl, and ⌘ for the machine where Ctrl+click is the right button", () => {
    expect(freeSnap({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(freeSnap({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(freeSnap({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe("snapTo", () => {
  it("lands on the nearest multiple", () => {
    expect(snapTo(1.4, 1)).toBe(1);
    expect(snapTo(1.6, 1)).toBe(2);
    expect(snapTo(0.3, 0.25)).toBe(0.25);
    expect(snapTo(-1.4, 1)).toBe(-1);
  });

  // A step of 0 IS the free case — what lets every caller write `free ? 0 : unit` instead of branching around this function.
  it("leaves the value alone when there is no step", () => {
    expect(snapTo(1.4, 0)).toBe(1.4);
    expect(snapTo(-0.37, 0)).toBe(-0.37);
  });
});

describe("dragOffset", () => {
  const PPB = 20;

  it("snaps the offset to the step", () => {
    expect(dragOffset(30, PPB, 1, 8)).toBe(2); // 1.5 beats travelled → 2
    expect(dragOffset(25, PPB, 0.5, 8)).toBe(1.5);
  });

  // The phase of a hand-placed event survives a snapped move: the OFFSET is what lands on the grid, never the resulting position.
  it("keeps an off-grid clip off the grid", () => {
    const start = 4.43;
    expect(start + dragOffset(4 * PPB, PPB, 1, start)).toBeCloseTo(8.43, 9);
  });

  it("follows the pointer exactly when free", () => {
    expect(dragOffset(30, PPB, 0, 8)).toBeCloseTo(1.5, 9);
    expect(dragOffset(7, PPB, 0, 8)).toBeCloseTo(0.35, 9);
  });

  // Dragged hard left a clip stops at the song's start — and, snapped, ON the grid it was walking rather than at a beat 0.
  it("stops at the start, on the step", () => {
    expect(3 + dragOffset(-500, PPB, 1, 3)).toBe(0);
    expect(3.4 + dragOffset(-500, PPB, 1, 3.4)).toBeCloseTo(0.4, 9);
    expect(3.4 + dragOffset(-500, PPB, 0, 3.4)).toBe(0); // free: all the way to 0
  });
});

describe("the move and resize modes", () => {
  const keys = (
    k: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey", boolean>>,
  ) => ({
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...k,
  });
  it("reads Shift as free, Ctrl (or Cmd) as relative, nothing as the grid", () => {
    expect(snapMode(keys({}))).toBe("grid");
    expect(snapMode(keys({ ctrlKey: true }))).toBe("relative");
    expect(snapMode(keys({ metaKey: true }))).toBe("relative");
    expect(snapMode(keys({ shiftKey: true, ctrlKey: true }))).toBe("free");
  });

  it("lands on the project's grid, keeps the event's own offset, or goes where the pointer is", () => {
    // An event at 2.3 dragged 1.4 beats, on a grid of whole beats.
    expect(snapPosition(2.3, 1.4, 1, "grid")).toBe(4);
    expect(snapPosition(2.3, 1.4, 1, "relative")).toBeCloseTo(3.3, 9);
    expect(snapPosition(2.3, 1.4, 1, "free")).toBeCloseTo(3.7, 9);
  });

  it("never moves an event before the song's start", () => {
    expect(moveOffset(-100, 10, 1, 2.3, "grid")).toBeCloseTo(-2.3, 9);
    // Relative: the nearest whole step that stays at or after 0.
    expect(moveOffset(-100, 10, 1, 2.3, "relative")).toBeCloseTo(-2, 9);
  });
});
