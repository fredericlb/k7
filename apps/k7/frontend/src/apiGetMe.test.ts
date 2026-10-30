// apiGetMe.test.ts — /auth/me is asked once for a start's several askers, and again after nobody or a failure.

import { afterEach, describe, expect, it, vi } from "vitest";

const { api } = await import("./api");

const answer = (status: number, user?: object) =>
  new Response(JSON.stringify({ user }), { status });

afterEach(() => {
  void api.logout().catch(() => {});
  vi.unstubAllGlobals();
});

describe("api.getMe", () => {
  it("shares a signed-in answer between askers", async () => {
    const fetch = vi.fn(async () => answer(200, { sub: "a" }));
    vi.stubGlobal("fetch", fetch);
    const [a, b] = await Promise.all([api.getMe(), api.getMe()]);
    expect(await api.getMe()).toEqual({ sub: "a" });
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks again after nobody signed in, or a failure", async () => {
    const fetch = vi
      .fn(async () => answer(200))
      .mockResolvedValueOnce(answer(401))
      .mockResolvedValueOnce(answer(502))
      .mockResolvedValueOnce(answer(200, { sub: "b" }));
    vi.stubGlobal("fetch", fetch);
    expect(await api.getMe()).toBeNull();
    await expect(api.getMe()).rejects.toThrow("auth/me 502");
    expect(await api.getMe()).toEqual({ sub: "b" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
