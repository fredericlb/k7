// The long press's timing and slop: a held still finger opens the menu once, movement or a second
// finger cancels it, and only a press that opened a menu swallows its click.

import { describe, expect, it } from "vitest";
import {
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  LongPressTracker,
  type PressPoint,
} from "./longPress";

function rig(handled = true) {
  let clock = 0;
  let pending: { fn: () => void; at: number } | null = null;
  const fired: [number, number][] = [];
  const t = new LongPressTracker(
    (x, y) => {
      fired.push([x, y]);
      return handled;
    },
    {
      set: (fn, ms) => {
        pending = { fn, at: clock + ms };
        return pending;
      },
      clear: (h) => {
        if (h === pending) pending = null;
      },
      now: () => clock,
    },
  );
  const advance = (ms: number) => {
    clock += ms;
    const p = pending;
    if (p && p.at <= clock) {
      pending = null;
      p.fn();
    }
  };
  return { t, fired, advance };
}

const at = (
  x: number,
  y: number,
  id = 1,
  pointerType = "touch",
): PressPoint => ({
  pointerId: id,
  pointerType,
  clientX: x,
  clientY: y,
  target: {} as EventTarget,
});

describe("LongPressTracker", () => {
  it("fires at the press point once the delay has passed without moving", () => {
    const { t, fired, advance } = rig();
    t.down(at(100, 50));
    advance(LONG_PRESS_MS - 1);
    expect(fired).toEqual([]);
    advance(1);
    expect(fired).toEqual([[100, 50]]);
  });

  it("tolerates a jitter within the slop, and cancels past it", () => {
    const a = rig();
    a.t.down(at(0, 0));
    a.t.move(at(LONG_PRESS_SLOP_PX - 1, 0));
    a.advance(LONG_PRESS_MS);
    expect(a.fired).toHaveLength(1);

    const b = rig();
    b.t.down(at(0, 0));
    b.t.move(at(LONG_PRESS_SLOP_PX, LONG_PRESS_SLOP_PX));
    b.advance(LONG_PRESS_MS);
    expect(b.fired).toHaveLength(0);
  });

  it("is cancelled by a release, a second finger, a mouse or a text field", () => {
    const up = rig();
    up.t.down(at(0, 0));
    up.t.end(at(0, 0));
    up.advance(LONG_PRESS_MS);
    expect(up.fired).toHaveLength(0);

    const pinch = rig();
    pinch.t.down(at(0, 0, 1));
    pinch.t.down(at(50, 50, 2));
    pinch.advance(LONG_PRESS_MS);
    expect(pinch.fired).toHaveLength(0);

    const mouse = rig();
    mouse.t.down(at(0, 0, 1, "mouse"));
    mouse.advance(LONG_PRESS_MS);
    expect(mouse.fired).toHaveLength(0);

    const field = rig();
    field.t.down(at(0, 0), true);
    field.advance(LONG_PRESS_MS);
    expect(field.fired).toHaveLength(0);
  });

  it("fires for a pen as for a finger", () => {
    const { t, fired, advance } = rig();
    t.down(at(3, 4, 7, "pen"));
    advance(LONG_PRESS_MS);
    expect(fired).toEqual([[3, 4]]);
  });

  it("swallows the one click after a handled press, and only soon after the release", () => {
    const { t, advance } = rig(true);
    t.down(at(0, 0));
    advance(LONG_PRESS_MS);
    t.end(at(0, 0));
    expect(t.takeClick()).toBe(true);
    expect(t.takeClick()).toBe(false);

    const late = rig(true);
    late.t.down(at(0, 0));
    late.advance(LONG_PRESS_MS);
    late.t.end(at(0, 0));
    late.advance(5000);
    expect(late.t.takeClick()).toBe(false);
  });

  it("lets the click through when no handler took the menu", () => {
    const { t, fired, advance } = rig(false);
    t.down(at(0, 0));
    advance(LONG_PRESS_MS);
    t.end(at(0, 0));
    expect(fired).toHaveLength(1);
    expect(t.takeClick()).toBe(false);
  });

  it("yields to a native menu before firing, and drops the native duplicate after", () => {
    const before = rig();
    before.t.down(at(0, 0));
    expect(before.t.nativeMenu()).toBe("let");
    before.advance(LONG_PRESS_MS);
    expect(before.fired).toHaveLength(0);

    const after = rig();
    after.t.down(at(0, 0));
    after.advance(LONG_PRESS_MS);
    expect(after.t.nativeMenu()).toBe("drop");
    after.t.end(at(0, 0));
    expect(after.t.nativeMenu()).toBe("let");
  });

  it("lets a native menu through when no press is held", () => {
    const { t } = rig();
    expect(t.nativeMenu()).toBe("let");
  });
});
