// A token arrives on a loopback port, which means anything able to make this machine open a
// URL could try to plant one. Three checks stand between that and a paired account: it came
// from HERE, a pairing was armed, and the state matches the nonce we generated. Each is tested
// by defeating the other two.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAIR_RETURN_PATH } from "@studio/web-protocol/pairing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalServer } from "./index.ts";
import { armPairing, pairingReturnUrl } from "./pairing.ts";

let home: string;
let local: Awaited<ReturnType<typeof startLocalServer>>;
let paired: { token: string; identity: string | null }[] = [];
const saved = process.env.STUDIO_HOME;
let nextPort = 39400;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "desk-pair-"));
  process.env.STUDIO_HOME = home;
  paired = [];
  const dist = join(home, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>st0</title>",
    "utf8",
  );
  local = await startLocalServer({
    port: (nextPort += 3),
    distDir: dist,
    host: "127.0.0.1",
    onPaired: (r) => paired.push(r),
  });
});

afterEach(async () => {
  await local.close();
  vi.useRealTimers();
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

const ret = (q: Record<string, string>) => {
  const u = new URL(`${local.url}${PAIR_RETURN_PATH}`);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return fetch(u);
};

describe("coming back from the browser", () => {
  it("takes the token, and the identity that comes with it", async () => {
    const state = armPairing();
    const r = await ret({
      state,
      token: "tok-1",
      identity: "fred@parapluie.org",
    });
    expect(r.status).toBe(200);
    expect(paired).toEqual([
      { token: "tok-1", identity: "fred@parapluie.org" },
    ]);
  });

  it("refuses a state that does not match the nonce we generated", async () => {
    armPairing();
    const r = await ret({ state: "guessed", token: "tok-2" });
    expect(r.status).toBe(400);
    expect(paired).toEqual([]);
  });

  it("refuses when nothing was armed — a link on its own must not pair anything", async () => {
    const r = await ret({ state: "anything", token: "tok-3" });
    expect(r.status).toBe(400);
    expect(paired).toEqual([]);
  });

  it("is ONE shot: a replayed return does not pair again", async () => {
    const state = armPairing();
    expect((await ret({ state, token: "tok-4" })).status).toBe(200);
    expect((await ret({ state, token: "tok-4" })).status).toBe(400);
    expect(paired).toHaveLength(1);
  });

  it("expires, so a nonce left lying around stops being one", async () => {
    const state = armPairing();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * 60_000);
    const r = await ret({ state, token: "tok-5" });
    expect(r.status).toBe(400);
    expect(paired).toEqual([]);
  });

  it("refuses a return carrying no token at all", async () => {
    const state = armPairing();
    expect((await ret({ state })).status).toBe(400);
    expect(paired).toEqual([]);
  });

  it("arming twice abandons the first — one pairing at a time", async () => {
    const first = armPairing();
    const second = armPairing();
    expect((await ret({ state: first, token: "x" })).status).toBe(400);
    expect(paired).toEqual([]);
    // And the second is now spent too, since the refusal consumed it.
    expect((await ret({ state: second, token: "y" })).status).toBe(400);
  });
});

describe("the return address", () => {
  it("is on OUR origin, which is what pl8 validates as loopback", () => {
    const u = new URL(pairingReturnUrl(local.url));
    expect(u.pathname).toBe(PAIR_RETURN_PATH);
    expect(u.hostname).toBe("127.0.0.1");
    expect(u.protocol).toBe("http:");
  });
});
