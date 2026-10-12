// A drag follows the pointer that pressed, commits on its release, and abandons on anything else.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followPointer } from "./drag";

// The window the helper listens on, as a bare event target: no DOM is mounted here.
let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal("window", win);
});
afterEach(() => vi.unstubAllGlobals());

const ev = (type: string, pointerId = 1) =>
  Object.assign(new Event(type), { pointerId }) as unknown as PointerEvent;

describe("followPointer", () => {
  it("moves and commits for the pressing pointer only", () => {
    const h = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    followPointer({ pointerId: 1 }, h);
    win.dispatchEvent(ev("pointermove", 2)); // another finger
    win.dispatchEvent(ev("pointerup", 2));
    expect(h.move).not.toHaveBeenCalled();
    expect(h.end).not.toHaveBeenCalled();
    win.dispatchEvent(ev("pointermove"));
    win.dispatchEvent(ev("pointerup"));
    expect(h.move).toHaveBeenCalledTimes(1);
    expect(h.end).toHaveBeenCalledTimes(1);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  // The bug this exists for: armed after a cancel, the next click anywhere committed the drag.
  it("abandons on a cancel, and a later release commits nothing", () => {
    const h = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    followPointer({ pointerId: 1 }, h);
    win.dispatchEvent(ev("pointercancel"));
    win.dispatchEvent(ev("pointermove"));
    win.dispatchEvent(ev("pointerup"));
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.move).not.toHaveBeenCalled();
    expect(h.end).not.toHaveBeenCalled();
  });

  it("abandons on focus lost, and on its own disposer, once", () => {
    const blur = { cancel: vi.fn(), end: vi.fn() };
    followPointer({ pointerId: 1 }, blur);
    win.dispatchEvent(new Event("blur"));
    expect(blur.cancel).toHaveBeenCalledTimes(1);

    const gone = { cancel: vi.fn(), end: vi.fn() };
    const abandon = followPointer({ pointerId: 1 }, gone);
    abandon();
    abandon();
    win.dispatchEvent(ev("pointerup"));
    expect(gone.cancel).toHaveBeenCalledTimes(1);
    expect(gone.end).not.toHaveBeenCalled();
  });
});
