// One cut at a time is a promise to the HOST, not a nicety: two separations at once make both
// slow and every other request in the image slow with them. The slot must also survive a
// failure, or one bad song stops the queue forever.

import type { SeparateJob } from "@studio/web-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Queue = typeof import("./queue");
let q: Queue;

// Module-level state, so each test gets its own copy of the module.
beforeEach(async () => {
  vi.resetModules();
  q = await import("./queue");
});

/** A run that only finishes when told to. */
function gate() {
  let release!: () => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { promise, release, fail };
}

const job = (id: string): SeparateJob => ({
  id,
  source: "s.mp3",
  done: false,
  failed: false,
  error: null,
  phase: "starting",
  percent: 0,
  lines: [],
  files: [],
});

describe("one at a time", () => {
  it("starts the first and holds the second", async () => {
    const a = gate();
    const b = gate();
    let bStarted = false;

    q.enqueue("a", () => a.promise);
    q.enqueue("b", () => {
      bStarted = true;
      return b.promise;
    });

    expect(bStarted).toBe(false);
    expect(q.ahead("b")).toBe(0);
    // The running one is not waiting, so it has no position.
    expect(q.ahead("a")).toBeNull();

    a.release();
    await a.promise;
    await Promise.resolve();
    expect(bStarted).toBe(true);
    b.release();
    await b.promise;
  });

  it("frees the slot when a run FAILS — one bad song must not stop the queue", async () => {
    const a = gate();
    let bStarted = false;
    q.enqueue("a", () => a.promise);
    q.enqueue("b", () => {
      bStarted = true;
      return Promise.resolve();
    });

    a.fail(new Error("no model"));
    await a.promise.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(bStarted).toBe(true);
  });

  it("counts the ones ahead, so a third knows it is third", () => {
    const a = gate();
    q.enqueue("a", () => a.promise);
    q.enqueue("b", () => Promise.resolve());
    q.enqueue("c", () => Promise.resolve());
    expect(q.ahead("b")).toBe(0);
    expect(q.ahead("c")).toBe(1);
    a.release();
  });
});

describe("the wait, drawn onto the job", () => {
  it("leaves a running job alone", () => {
    const a = gate();
    q.enqueue("a", () => a.promise);
    expect(q.withWait(job("a"))).toEqual(job("a"));
    a.release();
  });

  it("clears percent — a bar at 0% for ten minutes reads as a hang", () => {
    const a = gate();
    q.enqueue("a", () => a.promise);
    q.enqueue("b", () => Promise.resolve());
    const shown = q.withWait({ ...job("b"), percent: 0 });
    expect(shown.percent).toBeNull();
    expect(shown.phase).toBe("queued · next");
    a.release();
  });

  it("says how many are ahead once there is more than one", () => {
    const a = gate();
    q.enqueue("a", () => a.promise);
    q.enqueue("b", () => Promise.resolve());
    q.enqueue("c", () => Promise.resolve());
    expect(q.withWait(job("c")).phase).toBe("queued · 1 ahead");
    a.release();
  });
});
