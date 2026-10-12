import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { library, player } from "./api";

// A server that never answers: the promise settles only when its signal aborts.
const hang = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise<Response>((_ok, fail) => {
      init?.signal?.addEventListener("abort", () =>
        fail(init.signal?.reason ?? new DOMException("aborted", "AbortError")),
      );
    }),
);

beforeEach(() => {
  vi.useFakeTimers();
  hang.mockClear();
  vi.stubGlobal("fetch", hang);
  // Node's own timeout ignores fake timers; this one is the same signal on the faked clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException("late", "TimeoutError")), ms);
    return c.signal;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a call to a server that never answers", () => {
  it("gives up after its budget, with a sentence rather than a DOMException", async () => {
    const listing = library.list("songs");
    const settled = expect(listing).rejects.toThrow(
      "no answer from the server after 30 s",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
  });

  it("gives the host's transport a shorter one", async () => {
    const state = player.state();
    const settled = expect(state).rejects.toThrow("after 10 s");
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });

  it("never times an upload out, and lets the page cancel it", async () => {
    const ctl = new AbortController();
    const file = new File(["x"], "a.mp3");
    const upload = library.addSong(
      file,
      { artist: "a", album: "", title: "t" },
      { signal: ctl.signal },
    );
    let done = false;
    upload.catch(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(done).toBe(false);
    ctl.abort();
    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
  });
});
