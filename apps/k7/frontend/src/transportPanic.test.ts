// The rule that turns a second stop into a panic. What would be wrong silently: panicking on two
// unrelated presses (a panic resets every plugin, so it kills reverb tails somebody wanted), and
// NOT panicking when the first stop left a note hanging, which is the whole point of the gesture.

import { describe, expect, it } from "vitest";
import {
  PANIC_WINDOW_MS,
  stopOrPanic,
  throughPanicRule,
} from "./transportPanic";

describe("what a stop press means", () => {
  it("is a plain stop when nothing preceded it", () => {
    expect(stopOrPanic(1000, null)).toBe("stop");
  });

  it("is a PANIC when it lands inside the window of the last one", () => {
    expect(stopOrPanic(1000, 700)).toBe("panic");
    expect(stopOrPanic(1000, 1000 - PANIC_WINDOW_MS)).toBe("panic"); // the edge is inside
  });

  it("is a plain stop again once the window has passed", () => {
    // Two stops minutes apart are two stops: the second must not kill a tail nobody asked about.
    expect(stopOrPanic(1000, 1000 - PANIC_WINDOW_MS - 1)).toBe("stop");
    expect(stopOrPanic(100_000, 1000)).toBe("stop");
  });

  it("keeps panicking while the presses keep coming", () => {
    // Someone pressing a third time is not asking for less, and a panic costs nothing to repeat.
    let last: number | null = null;
    const out: string[] = [];
    for (const t of [0, 200, 400, 600]) {
      out.push(stopOrPanic(t, last));
      last = t;
    }
    expect(out).toEqual(["stop", "panic", "panic", "panic"]);
  });
});

describe("a sequence of transport verbs", () => {
  const run = (seq: [Parameters<typeof throughPanicRule>[0], number][]) => {
    let last: number | null = null;
    return seq.map(([verb, t]) => {
      const step = throughPanicRule(verb, t, last);
      last = step.lastStopAt;
      return step.send;
    });
  };

  it("panics on a double-click of the Stop button, which sends stop then rewind", () => {
    // The rewind the button sends after each stop must not reset the gesture.
    expect(
      run([
        ["stop", 0],
        ["rewind", 0],
        ["stop", 300],
        ["rewind", 300],
      ]),
    ).toEqual(["stop", "rewind", "panic", "rewind"]);
  });

  it("does not panic when a play came between the two stops", () => {
    expect(
      run([
        ["stop", 0],
        ["play", 100],
        ["stop", 300],
      ]),
    ).toEqual(["stop", "play", "stop"]);
    expect(
      run([
        ["stop", 0],
        ["toggle", 100],
        ["stop", 300],
      ]),
    ).toEqual(["stop", "toggle", "stop"]);
  });
});
