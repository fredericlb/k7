// registry.test.ts — `select` turns the registry's two "no" answers into a `ClaimLost`, never a
// network error: 409 (the claim moved on) and 403 `not-yours` (another account's engine).

import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimLost, registryClient } from "./registry";

const json = async <T>(res: Response, what: string): Promise<T> => {
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return (await res.json()) as T;
};

const answer = (status: number, body: object) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("registryClient.select", () => {
  it("throws a `refused` ClaimLost for another account's engine", async () => {
    answer(403, { error: "not-yours" });
    const e = await registryClient("", json)
      .select("e1", "tok", 3, null)
      .catch((x) => x);
    expect(e).toBeInstanceOf(ClaimLost);
    expect((e as ClaimLost).reason).toBe("refused");
  });

  it("leaves any other 403 a plain error", async () => {
    answer(403, { error: "bad token" });
    const e = await registryClient("", json)
      .select("e1", "tok", 3, null)
      .catch((x) => x);
    expect(e).not.toBeInstanceOf(ClaimLost);
  });
});
