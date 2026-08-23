// What `fget` shares and what it refuses to share. Both halves matter: collapsing the burst is
// the point, and answering a question asked AFTER a write with an answer fetched before it is
// the one way that could lie.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureFileApi, fget, fsend } from "./fileApi.ts";

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
          json: () => Promise.resolve({ url: String(url) }), // fsend still reads it this way
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

  // The aliasing this exists to avoid: a surface that writes into the document it was handed
  // would be writing into another component's state.
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
