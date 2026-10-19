// What `fget` shares and what it refuses to share. Both halves matter: collapsing the burst is
// the point, and answering a question asked AFTER a write with an answer fetched before it is
// the one way that could lie.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureFileApi,
  fget,
  fsend,
  READ_MS,
  setFileApiRevision,
  setFileApiTally,
} from "./fileApi.ts";

let served: string[] = [];
let release: (() => void)[] = [];

// A fetch that answers only when told to, so several callers are genuinely in flight at once.
function heldFetch(): void {
  vi.stubGlobal("fetch", (url: string) => {
    served.push(String(url));
    return new Promise((resolve) => {
      release.push(() =>
        resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ url: String(url) })),
          json: () => Promise.resolve({ url: String(url) }), // an error body is still read this way
        } as unknown as Response),
      );
    });
  });
}

const releaseAll = (): void => {
  for (const r of release) r();
  release = [];
};

beforeEach(() => {
  served = [];
  release = [];
  configureFileApi({
    base: "http://x",
    userEmail: "a@b.c",
    workspace: "w",
    engineToken: "t",
    engineId: "e1",
  });
  heldFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("fget", () => {
  it("asks once for a route several components want at the same moment", async () => {
    const all = Promise.all([fget("/graph"), fget("/graph"), fget("/graph")]);
    releaseAll();
    expect(await all).toHaveLength(3);
    expect(served).toEqual(["http://x/graph"]);
  });

  it("keeps two different routes apart", async () => {
    const all = Promise.all([fget("/graph"), fget("/project-doc")]);
    releaseAll();
    await all;
    expect(served).toHaveLength(2);
  });

  // Not a cache: nothing survives the request it came from.
  it("asks again once the first has settled", async () => {
    const first = fget("/graph");
    releaseAll();
    await first;
    const second = fget("/graph");
    releaseAll();
    await second;
    expect(served).toHaveLength(2);
  });

  // The aliasing this exists to avoid — a surface writing into another component's state.
  it("gives each caller its own object", async () => {
    const both = Promise.all([fget("/graph"), fget("/graph")]);
    releaseAll();
    const [a, b] = await both;
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("hands every caller the same failure", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({ error: "nope" })),
      } as unknown as Response),
    );
    const both = [fget("/graph"), fget("/graph")];
    await expect(both[0]).rejects.toThrow("nope");
    await expect(both[1]).rejects.toThrow("nope");
  });

  // The fence. A GET issued after a write may not be answered by one issued before it.
  it("does not answer a question asked after a write with an answer fetched before it", async () => {
    const stale = fget("/graph"); // in flight…
    const wrote = fsend("POST", "/command", { line: "x" }); // …a command lands…
    const fresh = fget("/graph"); // …and this must be its OWN request
    releaseAll();
    await Promise.allSettled([stale, wrote, fresh]);
    expect(served.filter((u) => u.endsWith("/graph"))).toHaveLength(2);
  });
});

describe("a token-derived read, once settled", () => {
  let token = "";
  // A fresh token per test, so nothing kept by one test answers the next.
  beforeEach(() => {
    token = `rev-${Math.random()}`;
    setFileApiRevision(
      () => token,
      (p) => p === "/graph",
    );
  });
  afterEach(() => {
    setFileApiRevision(
      () => null,
      () => false,
    );
    vi.useRealTimers();
  });

  const settle = async (path: string): Promise<unknown> => {
    const p = fget(path);
    releaseAll();
    return p;
  };

  it("answers a view mounting a moment later, at the same token", async () => {
    const a = await settle("/graph");
    const b = await settle("/graph");
    expect(served).toHaveLength(1);
    // Still parsed per caller: nobody shares an object.
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
  });

  it("asks again once the token moved", async () => {
    await settle("/graph");
    token = `${token}+edited`;
    await settle("/graph");
    expect(served).toHaveLength(2);
  });

  it("asks again after a write, whatever the token says", async () => {
    await settle("/graph");
    const wrote = fsend("POST", "/command", { line: "x" });
    releaseAll();
    await wrote;
    await settle("/graph");
    expect(served.filter((u) => u.endsWith("/graph"))).toHaveLength(2);
  });

  it("is not kept past a few seconds", async () => {
    vi.useFakeTimers();
    await settle("/graph");
    vi.advanceTimersByTime(6000);
    await settle("/graph");
    expect(served).toHaveLength(2);
  });

  it("leaves every other route a fresh request", async () => {
    await settle("/workspace");
    await settle("/workspace");
    expect(served).toHaveLength(2);
  });
});

describe("what the transport reports to a stall watcher", () => {
  let seen: { name: string; ms: number; bytes: number }[] = [];
  beforeEach(() => {
    seen = [];
    setFileApiTally((name, ms, bytes = 0) => seen.push({ name, ms, bytes }));
  });
  afterEach(() => setFileApiTally(() => {}));

  it("names the ROUTE and the bytes, not the whole path", () => {
    // A path carrying a file name would make every read its own line, and the busiest route
    // unfindable — which is the one thing the report exists to point at.
    const p = fget("/file?path=nodes/lead.yaml");
    releaseAll();
    return p.then(() => {
      expect(seen.map((s) => s.name)).toEqual(["GET /file"]);
      expect(seen[0].bytes).toBeGreaterThan(0);
    });
  });

  it("counts ONE fetch and one parse PER CALLER, which is what the sharing costs", async () => {
    // `fget` collapses the burst into one request and then parses per caller, deliberately: two
    // callers handed one object could corrupt each other's. The price is real and this is where
    // it shows — four readers of a large document parse it four times, on this thread.
    const all = Promise.all([fget("/hints"), fget("/hints"), fget("/hints")]);
    releaseAll();
    await all;
    expect(served).toEqual(["http://x/hints"]); // one request…
    expect(seen).toHaveLength(3); // …and three parses
  });
});

describe("a read that never answers", () => {
  it("is dropped after READ_MS, for every caller, and the next ask is a fresh request", async () => {
    vi.useFakeTimers();
    // Node's own timeout ignores fake timers; this one is the same signal on the faked clock.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException("late", "TimeoutError")), ms);
      return c.signal;
    });
    let asked = 0;
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      asked++;
      return new Promise((_ok, fail) =>
        init?.signal?.addEventListener("abort", () =>
          fail(init.signal?.reason),
        ),
      );
    });
    try {
      const a = fget("/revision");
      const b = fget("/revision");
      const both = expect(Promise.all([a, b])).rejects.toThrow("no answer");
      await vi.advanceTimersByTimeAsync(READ_MS);
      await both;
      void fget("/revision").catch(() => {});
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
