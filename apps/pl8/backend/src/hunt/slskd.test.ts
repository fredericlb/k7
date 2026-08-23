import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseSearch } from "./slskd.ts";

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
  process.env.SLSKD_URL = "http://slskd.test:5030";
  process.env.SLSKD_API_KEY = "k";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("releaseSearch", () => {
  it("arrête la recherche AVANT de la supprimer", async () => {
    // The original bug: deleting a search still running makes slskd throw
    // DbUpdateConcurrencyException, since it updates the row as answers come in —
    // "expected to affect 1 row(s), but actually affected 0 row(s)".
    stub(() => true);
    await releaseSearch("abc");
    expect(calls).toEqual([
      "PUT /api/v0/searches/abc",
      "GET /api/v0/searches/abc",
      "DELETE /api/v0/searches/abc",
    ]);
  });

  it("ne supprime rien tant que la recherche n'est pas terminée", async () => {
    // A search outlives the interest taken in it: what arrived within a few seconds is filed while
    // Soulseek is still answering. Leaving the row is the right call — one extra row on slskd
    // costs nothing, a stack trace does.
    stub(() => false);
    // The delay is passed in: in production it is ten seconds, and waiting for it here would check
    // nothing but vitest's patience.
    await releaseSearch("abc", 30);
    expect(calls).toContain("PUT /api/v0/searches/abc");
    expect(calls).not.toContain("DELETE /api/v0/searches/abc");
  });

  it("ne lève jamais : c'est du ménage, pas le résultat de la recherche", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("slskd injoignable");
    }) as unknown as typeof fetch;
    await expect(releaseSearch("abc", 30)).resolves.toBeUndefined();
  });
});
