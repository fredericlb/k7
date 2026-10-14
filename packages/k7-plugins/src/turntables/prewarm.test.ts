// Warming the set list. What would be wrong silently here: firing the whole list at the engine at
// once (so the record somebody is loading queues behind twenty-nine others), stopping the walk on
// the first unreadable file, and carrying on after the desk has moved to another playlist.

import { describe, expect, it, vi } from "vitest";
import { NO_PREWARM, type Prewarm, prewarming, prewarmSet } from "./prewarm";

/** An analyser that records the ORDER it was called in, and how many were in flight at once. */
function tracker(fail: readonly string[] = []) {
  const started: string[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    started,
    peak: () => peak,
    analyse: async (path: string) => {
      started.push(path);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (fail.includes(path)) throw new Error(`cannot read ${path}`);
      return {};
    },
  };
}

describe("prewarmSet", () => {
  it("analyses ONE at a time, in the playlist's order", async () => {
    // The whole reason it is sequential: the analysis is the engine's, and a set list fired at it
    // in parallel would compete with the record somebody is actually putting on.
    const t = tracker();
    const at = await prewarmSet(
      ["a", "b", "c"],
      t.analyse,
      () => true,
      () => {},
    );
    expect(t.started).toEqual(["a", "b", "c"]);
    expect(t.peak()).toBe(1);
    expect(at).toEqual({ done: 3, failed: 0, total: 3 });
  });

  it("COUNTS a failure and carries on", async () => {
    // One unreadable file must not cost the twenty-nine after it.
    const t = tracker(["b"]);
    const at = await prewarmSet(
      ["a", "b", "c"],
      t.analyse,
      () => true,
      () => {},
    );
    expect(t.started).toEqual(["a", "b", "c"]);
    expect(at).toEqual({ done: 2, failed: 1, total: 3 });
  });

  it("stops between songs when the desk has moved on", async () => {
    // A second playlist, or a closed surface: the walk must not keep the engine busy for a set
    // nobody is looking at any more.
    const t = tracker();
    let alive = true;
    const at = await prewarmSet(
      ["a", "b", "c"],
      async (p) => {
        if (p === "a") alive = false;
        return t.analyse(p);
      },
      () => alive,
      () => {},
    );
    expect(t.started).toEqual(["a"]);
    expect(at.done + at.failed).toBeLessThan(3);
  });

  it("reports progress as it goes, starting from zero", async () => {
    // The desk draws this; a run that only reported at the END would show nothing for a minute.
    const seen: Prewarm[] = [];
    const t = tracker();
    await prewarmSet(
      ["a", "b"],
      t.analyse,
      () => true,
      (p) => seen.push(p),
    );
    expect(seen[0]).toEqual({ done: 0, failed: 0, total: 2 });
    expect(seen.at(-1)).toEqual({ done: 2, failed: 0, total: 2 });
  });

  it("says nothing at all about an empty set list", async () => {
    const analyse = vi.fn();
    const at = await prewarmSet(
      [],
      analyse,
      () => true,
      () => {
        throw new Error("must not report progress for an empty list");
      },
    );
    expect(analyse).not.toHaveBeenCalled();
    expect(at).toEqual(NO_PREWARM);
  });
});

describe("prewarming", () => {
  it("is false before it starts and after it ends — the desk draws nothing either side", () => {
    expect(prewarming(NO_PREWARM)).toBe(false);
    expect(prewarming({ done: 3, failed: 0, total: 3 })).toBe(false);
    // …including when the list finished badly: nothing is still RUNNING.
    expect(prewarming({ done: 1, failed: 2, total: 3 })).toBe(false);
  });

  it("is true only while there is something left to analyse", () => {
    expect(prewarming({ done: 1, failed: 0, total: 3 })).toBe(true);
  });
});
