// useRevision.test.ts — the shared token poller's contracts: one timer whatever the number of
// consumers, a notification only when the token actually MOVED, no second ask stacked on a slow
// answer, and an unreachable service that neither notifies nor forgets what it last knew.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRevisionPoller } from "./useRevision";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Let the microtask queue drain — `pull` awaits its fetch before notifying.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("createRevisionPoller", () => {
  it("asks once immediately, then on the interval, however many consumers there are", async () => {
    let calls = 0;
    const p = createRevisionPoller(async () => `r${calls++}`, 2000);
    p.subscribe(() => {});
    p.subscribe(() => {});
    p.subscribe(() => {});
    await settle();
    expect(calls).toBe(1); // three consumers, ONE request

    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(3);
  });

  it("notifies only when the token moved", async () => {
    let rev = "a";
    const seen: number[] = [];
    const p = createRevisionPoller(async () => rev, 2000);
    p.subscribe(() => seen.push(1));
    await settle();
    expect(seen).toHaveLength(1); // the first read is a move: null -> "a"

    await vi.advanceTimersByTimeAsync(2000); // same token
    expect(seen).toHaveLength(1);

    rev = "b";
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toHaveLength(2);
    expect(p.get()).toBe("b");
  });

  it("stops the timer when the last consumer leaves, and restarts for the next", async () => {
    let calls = 0;
    const p = createRevisionPoller(async () => `r${calls++}`, 2000);
    const offA = p.subscribe(() => {});
    const offB = p.subscribe(() => {});
    await settle();
    expect(calls).toBe(1);

    offA();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2); // B still listening

    offB();
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toBe(2); // nobody left: no more asking

    p.subscribe(() => {});
    await settle();
    expect(calls).toBe(3); // and it wakes back up
  });

  it("does not stack a second ask on a slow answer", async () => {
    let calls = 0;
    // Held on an object rather than a `let`: assigned only inside the executor, a bare binding
    // narrows to `never` and cannot be called back.
    const pending: { release: ((v: string) => void) | null } = {
      release: null,
    };
    const p = createRevisionPoller(() => {
      calls++;
      return new Promise<string>((res) => {
        pending.release = res;
      });
    }, 1000);
    p.subscribe(() => {});
    await settle();
    expect(calls).toBe(1);

    // Five ticks go by while the first request is still out.
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(1);

    pending.release?.("a");
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2); // only once it answered does the next one go
  });

  it("adopts a noted token silently, so the next tick has nothing to announce", async () => {
    let rev = "a";
    const seen: number[] = [];
    const p = createRevisionPoller(async () => rev, 2000);
    p.subscribe(() => seen.push(1));
    await settle();
    expect(seen).toHaveLength(1); // null -> "a"

    // A writing command answered with "b" and the caller reloaded on the spot.
    rev = "b";
    p.note("b");
    expect(seen).toHaveLength(1); // silent: nobody is told
    expect(p.get()).toBe("b");

    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toHaveLength(1); // …and the tick that reads "b" has nothing to say either

    rev = "c"; // somebody else's edit still gets through
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toHaveLength(2);
  });

  it("does not let an answer fetched before a note overwrite it", async () => {
    const seen: number[] = [];
    const pending: { release: ((v: string) => void) | null } = {
      release: null,
    };
    const p = createRevisionPoller(
      () =>
        new Promise<string>((res) => {
          pending.release = res;
        }),
      1000,
    );
    p.subscribe(() => seen.push(1));
    await settle(); // a poll is in the air, holding the token from BEFORE the write

    p.note("b"); // the command landed while it was out
    pending.release?.("a"); // …and now the stale answer arrives
    await settle();
    expect(p.get()).toBe("b"); // it does not win
    expect(seen).toHaveLength(0); // and announces nothing, or the second pass is back
  });

  it("keeps the last token, and notifies nobody, when the service is unreachable", async () => {
    let ok = true;
    const seen: number[] = [];
    const p = createRevisionPoller(async () => {
      if (!ok) throw new Error("unreachable");
      return "a";
    }, 2000);
    p.subscribe(() => seen.push(1));
    await settle();
    expect(p.get()).toBe("a");

    ok = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.get()).toBe("a"); // not cleared
    expect(seen).toHaveLength(1); // and no spurious notification

    ok = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toHaveLength(1); // same token as before the outage: still nothing to say
  });
});
