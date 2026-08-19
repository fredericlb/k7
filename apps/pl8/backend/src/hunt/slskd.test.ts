import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseSearch } from "./slskd.ts";

/** Chaque appel vu par le faux fetch, dans l'ordre : « PUT /searches/x ». */
let calls: string[] = [];
const realFetch = globalThis.fetch;

/** `done` décide de ce que répond `GET /searches/{id}` — c'est tout ce que la libération lit. */
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
    // Le bug d'origine : supprimer une recherche encore en cours fait lever
    // DbUpdateConcurrencyException à slskd, qui met à jour la ligne au fil des réponses —
    // « expected to affect 1 row(s), but actually affected 0 row(s) ».
    stub(() => true);
    await releaseSearch("abc");
    expect(calls).toEqual([
      "PUT /api/v0/searches/abc",
      "GET /api/v0/searches/abc",
      "DELETE /api/v0/searches/abc",
    ]);
  });

  it("ne supprime rien tant que la recherche n'est pas terminée", async () => {
    // Une recherche survit à l'intérêt qu'on lui porte : on classe ce qui est arrivé au bout
    // de quelques secondes pendant que Soulseek répond encore. Laisser la ligne est le bon
    // choix — une ligne de trop chez slskd ne coûte rien, une trace de pile si.
    stub(() => false);
    // Le délai passé en argument : en vrai il est de dix secondes, et l'attendre ici ne
    // vérifierait rien de plus que la patience de vitest.
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
