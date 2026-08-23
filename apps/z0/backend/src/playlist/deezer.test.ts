import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDeezerState, previewUrl, trackByISRC } from "./deezer.ts";

// The cache keys off the URL's own `exp` stamp, not a fixed TTL; the limiter is pinned here too.

const previewFor = (id: number, expUnix: number) =>
  `https://cdn.example/${id}.mp3?hdnea=exp=${expUnix}~acl=/x~hmac=deadbeef`;

const soon = () => Math.floor(Date.now() / 1000) + 900; // Deezer's real ~15 min
const past = () => Math.floor(Date.now() / 1000) - 10;

beforeEach(() => __resetDeezerState());
afterEach(() => vi.unstubAllGlobals());

describe("previewUrl", () => {
  it("caches while the signature is valid", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 7, preview: previewFor(7, soon()) })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const a = await previewUrl(7);
    const b = await previewUrl(7);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-resolves once the signature has expired", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      // First answer is already stale; the second is fresh.
      const exp = n === 1 ? past() : soon();
      return new Response(
        JSON.stringify({ id: 7, preview: previewFor(n, exp) }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await previewUrl(7);
    const second = await previewUrl(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second).toContain("/2.mp3");
  });

  it("returns null for a track with no preview instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: 7, preview: "" }))),
    );
    expect(await previewUrl(7)).toBeNull();
  });

  it("returns null when Deezer answers with its 200-plus-error shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { type: "DataException", message: "no data" },
            }),
          ),
      ),
    );
    expect(await previewUrl(999)).toBeNull();
  });
});

describe("rate limiter", () => {
  it("never runs more than 4 requests at once", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight--;
        return new Response(JSON.stringify({ id: 1, preview: "x" }));
      }),
    );

    // 30 stays inside one window, so this measures concurrency alone.
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => trackByISRC(`ISRC${i}`)),
    );
    expect(peak).toBeLessThanOrEqual(4);
  });
});
