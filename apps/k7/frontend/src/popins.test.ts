// The overlay stack the shell's Escape reads. The rules that matter are "the last one opened is
// the one that closes" and "closing does not pop" — both are what stop one keypress closing two
// things. See docs/shell.md.

import { describe, expect, it } from "vitest";
import { closeTopPopin, registerPopin } from "./popins";

describe("the popin stack", () => {
  it("says there is nothing to close when nothing is up", () => {
    expect(closeTopPopin()).toBe(false);
  });

  it("closes the LAST one opened", () => {
    const closed: string[] = [];
    const offA = registerPopin(() => closed.push("a"));
    const offB = registerPopin(() => closed.push("b"));
    expect(closeTopPopin()).toBe(true);
    expect(closed).toEqual(["b"]);
    offB();
    // With b gone, a is now the one in front.
    expect(closeTopPopin()).toBe(true);
    expect(closed).toEqual(["b", "a"]);
    offA();
    expect(closeTopPopin()).toBe(false);
  });

  // The owner deregisters through its own effect cleanup, so a closer that declines must still be there for the next Escape.
  it("does not pop the entry itself", () => {
    let calls = 0;
    const off = registerPopin(() => {
      calls += 1;
    });
    expect(closeTopPopin()).toBe(true);
    expect(closeTopPopin()).toBe(true);
    expect(calls).toBe(2);
    off();
    expect(closeTopPopin()).toBe(false);
  });

  it("deregistering out of order removes the right entry", () => {
    const closed: string[] = [];
    const offA = registerPopin(() => closed.push("a"));
    const offB = registerPopin(() => closed.push("b"));
    offA(); // the one UNDER the top went away on its own
    expect(closeTopPopin()).toBe(true);
    expect(closed).toEqual(["b"]);
    offB();
  });
});
