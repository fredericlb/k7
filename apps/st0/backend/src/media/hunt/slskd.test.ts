import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseSearch, type SlskdConfig } from "./slskd.ts";

const cfg: SlskdConfig = { url: "http://slskd.test:5030", key: "k" };

/** Every call the fake fetch saw, in order: "PUT /searches/x". */
let calls: string[] = [];
const realFetch = globalThis.fetch;

/** `done` decides what `GET /searches/{id}` answers — all the release reads. */
function stub(done: () => boolean) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
    const body = method === "GET" ? JSON.stringify({ isComplete: done() }) : "";
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("releaseSearch", () => {
  it("arrête la recherche AVANT de la supprimer", async () => {
    // The original bug: deleting a running search makes slskd throw — ../../../docs/media/hunt.md.
    stub(() => true);
    await releaseSearch(cfg, "abc");
    expect(calls).toEqual([
      "PUT /api/v0/searches/abc",
      "GET /api/v0/searches/abc",
      "DELETE /api/v0/searches/abc",
    ]);
  });

  it("ne supprime rien tant que la recherche n'est pas terminée", async () => {
    // Leaving the row is the right call: one extra row on slskd costs nothing, a stack trace does.
    stub(() => false);
    // The delay is passed in; waiting the production ten seconds would test vitest's patience.
    await releaseSearch(cfg, "abc", 30);
    expect(calls).toContain("PUT /api/v0/searches/abc");
    expect(calls).not.toContain("DELETE /api/v0/searches/abc");
  });

  it("ne lève jamais : c'est du ménage, pas le résultat de la recherche", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("slskd injoignable");
    }) as unknown as typeof fetch;
    await expect(releaseSearch(cfg, "abc", 30)).resolves.toBeUndefined();
  });
});
