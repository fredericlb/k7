import { ENGINE_ASSIGN_RENEW_MS } from "@studio/web-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdEngine } from "./lease";
import { ClaimLost } from "./registry";

// The loop listens for `pagehide`, and node has no window, so a two-method stub is the whole DOM this needs.
const listeners: Record<string, () => void> = {};
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { window?: unknown }).window = {
    addEventListener: (k: string, f: () => void) => {
      listeners[k] = f;
    },
    removeEventListener: (k: string) => {
      delete listeners[k];
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
});

/** Records every select, and answers whatever the queue says — a grant unless told otherwise. */
function api(answers: Array<Error | string> = []) {
  const calls: Array<{ project: string | null; secret?: string }> = [];
  let n = 0;
  return {
    calls,
    released: [] as string[],
    select(
      _id: string,
      _token: string,
      _ms: number,
      project: string | null,
      secret?: string,
    ) {
      calls.push({ project, secret });
      const a = answers[n++] ?? `s${n}`;
      return a instanceof Error
        ? Promise.reject(a)
        : Promise.resolve({ ok: true as const, secret: a });
    },
    release(_id: string, secret: string) {
      this.released.push(secret);
    },
  };
}

describe("holdEngine", () => {
  it("renews with the secret it was granted", async () => {
    const a = api();
    holdEngine(a, "e1", "tok", 3, { project: "songs/first" });
    await vi.advanceTimersByTimeAsync(ENGINE_ASSIGN_RENEW_MS + 1);
    expect(a.calls).toEqual([
      { project: "songs/first", secret: undefined },
      { project: "songs/first", secret: "s1" },
    ]);
  });

  it("re-OPENS after a lapse, without telling the surface", async () => {
    const a = api([
      "s1",
      new ClaimLost("", "lapsed"), // asleep long enough for the secret to age out
    ]);
    const onLost = vi.fn();
    holdEngine(a, "e1", "tok", 3, { project: "songs/first", onLost });
    await vi.advanceTimersByTimeAsync(ENGINE_ASSIGN_RENEW_MS * 2 + 1);
    expect(onLost).not.toHaveBeenCalled();
    // Third call carries NO secret: an open, which the registry always grants.
    expect(a.calls[2]).toEqual({ project: "songs/first", secret: undefined });
  });

  it("waits a whole tick before re-opening, so a gone engine is not hammered", async () => {
    const a = api([new ClaimLost("", "lapsed"), new ClaimLost("", "lapsed")]);
    holdEngine(a, "e1", "tok", 3, { project: "songs/first" });
    await vi.advanceTimersByTimeAsync(ENGINE_ASSIGN_RENEW_MS - 1);
    expect(a.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(a.calls).toHaveLength(2);
  });

  it("stops for good when somebody took the project", async () => {
    const a = api(["s1", new ClaimLost("ana@x", "project")]);
    const onLost = vi.fn();
    holdEngine(a, "e1", "tok", 3, { project: "songs/first", onLost });
    await vi.advanceTimersByTimeAsync(ENGINE_ASSIGN_RENEW_MS * 3 + 1);
    expect(onLost).toHaveBeenCalledWith("ana@x", {
      reason: "project",
      tookFor: null,
    });
    expect(a.calls).toHaveLength(2); // no third: the interval is cleared
  });

  it("stops for good when another project took the engine, naming it", async () => {
    const a = api(["s1", new ClaimLost("ana@x", "engine", "songs/other")]);
    const onLost = vi.fn();
    holdEngine(a, "e1", "tok", 3, { project: "songs/first", onLost });
    await vi.advanceTimersByTimeAsync(ENGINE_ASSIGN_RENEW_MS * 2 + 1);
    expect(onLost).toHaveBeenCalledWith("ana@x", {
      reason: "engine",
      tookFor: "songs/other",
    });
  });

  it("keeps renewing through a network miss — only a 409 is an answer", async () => {
    const a = api(["s1", new Error("offline")]);
    const onLost = vi.fn();
    holdEngine(a, "e1", "tok", 3, { project: "songs/first", onLost });
    await vi.advanceTimersByTimeAsync(ENGINE_ASSIGN_RENEW_MS * 2 + 1);
    expect(onLost).not.toHaveBeenCalled();
    // Still the secret we hold: a miss loses nothing.
    expect(a.calls[2]).toEqual({ project: "songs/first", secret: "s1" });
  });
});
