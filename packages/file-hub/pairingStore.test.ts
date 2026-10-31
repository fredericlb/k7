// pairingStore.test.ts — a pairing's states, and what a process started again finds of them on disk.

import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PAIR_KEEP_MS, PAIR_WAIT_MS, PairingStore } from "./pairingStore.ts";

let dir: string;
let clock: number;
const now = () => clock;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pairing-store-"));
  clock = 1_000_000;
});

describe("PairingStore", () => {
  it("starts a pairing waiting, with a fresh state and a deadline", () => {
    const s = new PairingStore(dir, now);
    const a = s.begin("eve@x.test", "https://o.test", true);
    const b = s.begin("bob@x.test", "https://o.test", true);
    expect(a.phase).toBe("waiting");
    expect(a.until).toBe(clock + PAIR_WAIT_MS);
    expect(a.state).toMatch(/^[\w-]{22}$/);
    expect(a.state).not.toBe(b.state);
    expect(s.get(a.state)?.email).toBe("eve@x.test");
  });

  it("keeps one pairing per account: a second one replaces the first", () => {
    const s = new PairingStore(dir, now);
    const a = s.begin("eve@x.test", "https://o.test", true);
    const b = s.begin("eve@x.test", "https://p.test", false);
    expect(s.get(a.state)).toBeNull();
    expect(s.ofAccount("eve@x.test")?.state).toBe(b.state);
  });

  it("settles a waiting pairing once, and never one already ended", () => {
    const s = new PairingStore(dir, now);
    const a = s.begin("eve@x.test", "https://o.test", true);
    expect(s.settle(a.state, "alreadyLinked", "bob@x.test")?.browserAs).toBe(
      "bob@x.test",
    );
    expect(s.settle(a.state, "paired")).toBeNull();
    expect(s.get(a.state)?.phase).toBe("alreadyLinked");
  });

  it("reads a waiting pairing past its deadline as expired, which settles nothing", () => {
    const s = new PairingStore(dir, now);
    const a = s.begin("eve@x.test", "https://o.test", true);
    clock += PAIR_WAIT_MS;
    expect(s.get(a.state)?.phase).toBe("expired");
    expect(s.settle(a.state, "paired")).toBeNull();
  });

  it("is found again by a process started anew, waiting or ended", () => {
    const s = new PairingStore(dir, now);
    const a = s.begin("eve@x.test", "https://o.test", false);
    const b = s.begin("bob@x.test", "https://o.test", true);
    s.settle(b.state, "paired");
    const again = new PairingStore(dir, now);
    expect(again.get(a.state)).toMatchObject({
      email: "eve@x.test",
      origin: "https://o.test",
      main: false,
      phase: "waiting",
    });
    expect(again.ofAccount("bob@x.test")?.phase).toBe("paired");
    // Windows has no POSIX mode: a file there always reads 0o666.
    if (process.platform !== "win32")
      expect(statSync(join(dir, ".sync-pairing.json")).mode & 0o777).toBe(
        0o600,
      );
  });

  it("drops what has been kept long enough, and what was forgotten", () => {
    const s = new PairingStore(dir, now);
    const a = s.begin("eve@x.test", "https://o.test", true);
    const b = s.begin("bob@x.test", "https://o.test", true);
    expect(s.forget(b.state)).toBe(true);
    expect(s.forget(b.state)).toBe(false);
    clock += PAIR_WAIT_MS + PAIR_KEEP_MS;
    s.begin("ann@x.test", "https://o.test", true);
    const file = readFileSync(join(dir, ".sync-pairing.json"), "utf8");
    expect(file).not.toContain(a.state);
    expect(file).not.toContain(b.state);
    expect(file).toContain("ann@x.test");
  });

  it("starts empty on a file that is not one", () => {
    const s = new PairingStore(join(dir, "nowhere"), now);
    expect(s.ofAccount("eve@x.test")).toBeNull();
  });

  it("wakes a waiter when the pairing ends or goes, and answers after its time otherwise", async () => {
    const s = new PairingStore(dir);
    const a = s.begin("eve@x.test", "https://o.test", true);
    const waited = s.wait(a.state, 5_000);
    s.settle(a.state, "paired");
    expect((await waited)?.phase).toBe("paired");
    const b = s.begin("bob@x.test", "https://o.test", true);
    const gone = s.wait(b.state, 5_000);
    s.forget(b.state);
    expect(await gone).toBeNull();
    const c = s.begin("ann@x.test", "https://o.test", true);
    expect((await s.wait(c.state, 10))?.phase).toBe("waiting");
  });
});
