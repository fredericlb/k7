// The playhead keys outrun the engine: a step pressed before the last one's echo steps on from it.

import { describe, expect, it } from "vitest";
import type { LocalCtx } from "./context";
import { STEP_ECHO_MS, stepOrigin, TRANSPORT_COMMANDS } from "./transport";

describe("stepOrigin", () => {
  it("steps on from the last target while the playhead has not caught up", () => {
    expect(stepOrigin(0, { from: 0, to: 0.5, at: 1000 }, 1010)).toBe(0.5);
  });

  it("reads the playhead once the engine has answered", () => {
    expect(stepOrigin(0.5, { from: 0, to: 0.5, at: 1000 }, 1010)).toBe(0.5);
    expect(stepOrigin(3, { from: 0, to: 0.5, at: 1000 }, 1010)).toBe(3);
  });

  it("gives up on a step the engine never echoed", () => {
    expect(stepOrigin(0, { from: 0, to: 0.5, at: 0 }, STEP_ECHO_MS + 1)).toBe(
      0,
    );
  });
});

describe("transport step next", () => {
  const next = TRANSPORT_COMMANDS.find((c) => c.name === "transport step next");
  // A grid of half-second ticks, and an engine that has not echoed any seek yet.
  const ctxFor = (seeks: number[]) =>
    ({
      store: { getSnapshot: () => ({ playhead: 0 }) },
      timelineRef: {
        current: {
          stepTarget: (sec: number, dir: 1 | -1) =>
            Math.max(0, (Math.floor(sec / 0.5 + 1e-9) + dir) * 0.5),
        },
      },
      seek: (s: number) => seeks.push(s),
    }) as unknown as LocalCtx;

  it("moves three ticks on three presses, before any echo", () => {
    const seeks: number[] = [];
    const ctx = ctxFor(seeks);
    for (let i = 0; i < 3; i++) next?.run(ctx, "", "");
    expect(seeks).toEqual([0.5, 1, 1.5]);
  });
});
