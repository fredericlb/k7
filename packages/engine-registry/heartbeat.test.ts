// heartbeat.test.ts — a heartbeat is refused only for what the registry cannot do without, and
// every other odd field is cleaned and SAID. What this pins is the Windows machine that was listed
// once and then refused every heartbeat for one out-of-bounds number: listed, lapsed fifteen
// seconds later, and a play answered "unknown engine or bad token". docs/heartbeat.md.

import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHeartbeat, throttledLog } from "./heartbeat.ts";
import { createRegistry, type EngineRegistry } from "./registry.ts";
import { engineRegistryRouter } from "./router.ts";

/** What a supervisor sends, well-formed. */
const good = () => ({
  id: "e1",
  token: "tok-e1",
  hostname: "studio",
  machineFingerprint: "fp",
  port: 8765,
  addresses: { loopback: "127.0.0.1", lanIps: ["192.168.1.20"], port: 8765 },
  performance: {
    score: 1200,
    cores: 8,
    singleThread: 70,
    diskWriteMBps: 900,
    fsyncPerSec: 400,
    memoryGB: 32,
  },
});

describe("readHeartbeat", () => {
  it("takes a well-formed heartbeat as sent, cleaning nothing", () => {
    const r = readHeartbeat(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.beat.cleaned).toEqual([]);
    expect(r.beat.addresses).toEqual(good().addresses);
    expect(r.beat.performance?.score).toBe(1200);
  });

  it("KEEPS the engine when its performance block is out of bounds, leaving the block out", () => {
    const b = good();
    b.performance.fsyncPerSec = 5e7; // an NVMe whose flush is a no-op, measured as absurdly fast
    const r = readHeartbeat(b);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.beat.performance).toBeUndefined();
    expect(r.beat.cleaned.join(" ")).toMatch(
      /performance left out — fsyncPerSec/,
    );
  });

  it("drops an address that is not IPv4 and keeps the rest", () => {
    const b = {
      ...good(),
      addresses: {
        loopback: "::1",
        lanIps: ["192.168.1.20", "fe80::1", 7],
        port: 8765,
      },
    };
    const r = readHeartbeat(b);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.beat.addresses).toEqual({
      loopback: "127.0.0.1",
      lanIps: ["192.168.1.20"],
      port: 8765,
    });
    expect(r.beat.cleaned).toHaveLength(3);
  });

  it("refuses only what it cannot do without — and says which field", () => {
    const noToken = { ...good(), token: "" };
    const noPort = {
      ...good(),
      addresses: { loopback: "127.0.0.1", lanIps: [] },
    };
    const a = readHeartbeat(noToken);
    const b = readHeartbeat(noPort);
    expect(a.ok || b.ok).toBe(false);
    if (a.ok || b.ok) return;
    expect(a.error).toMatch(/^token:/);
    expect(b.error).toMatch(/^addresses\.port:/);
  });

  it("takes a heartbeat with no hostname or performance at all", () => {
    const r = readHeartbeat({
      id: "e1",
      token: "t",
      addresses: { port: 8765 },
    });
    expect(r.ok && r.beat.hostname === "" && r.beat.addresses.loopback).toBe(
      "127.0.0.1",
    );
  });

  it("keeps the library level a machine runs, and leaves out one that is no level", () => {
    const kept = readHeartbeat({ ...good(), libraryLevel: 2 });
    expect(kept.ok && kept.beat.libraryLevel).toBe(2);
    const odd = readHeartbeat({ ...good(), libraryLevel: "two" });
    expect(odd.ok && odd.beat.libraryLevel).toBeUndefined();
    expect(odd.ok && odd.beat.cleaned).toEqual([
      'libraryLevel: "two" is no level, left out',
    ]);
  });
});

describe("throttledLog", () => {
  it("says a complaint once a minute, and a different one at once", () => {
    const lines: string[] = [];
    let t = 0;
    const say = throttledLog(
      (l) => lines.push(l),
      60_000,
      () => t,
    );
    say("e1|x", "first");
    say("e1|x", "again");
    say("e1|y", "other");
    t = 60_000;
    say("e1|x", "a minute on");
    expect(lines).toEqual(["first", "other", "a minute on"]);
  });
});

describe("the routes", () => {
  let reg: EngineRegistry;
  let base: string;
  let close: () => void;
  const logged: string[] = [];

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };

  beforeEach(async () => {
    logged.length = 0;
    reg = createRegistry();
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      engineRegistryRouter(reg, undefined, (l) => logged.push(l)),
    );
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterEach(() => close());

  it("LISTS an engine whose heartbeat carried an out-of-bounds rating, and logs what it cleaned", async () => {
    const b = good();
    b.performance.cores = 0;
    const r = await post("/registry/heartbeat", b);
    expect(r.status).toBe(200);
    expect(r.body.cleaned).toEqual([expect.stringMatching(/cores/)]);
    expect(reg.get("e1")?.performance).toBeUndefined();
    expect(logged.join("\n")).toMatch(/engine e1 \(studio\).*cleaned/);
  });

  it("refuses a heartbeat it cannot use with the REASON in the body, for the supervisor's log", async () => {
    const r = await post("/registry/heartbeat", { ...good(), token: "" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/heartbeat refused — token:/);
    expect(logged.join("\n")).toMatch(/refused a heartbeat from engine e1/);
  });

  it("logs a token mismatch and names the way out", async () => {
    await post("/registry/heartbeat", good());
    const r = await post("/registry/heartbeat", { ...good(), token: "other" });
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toMatch(/freed 15 s after/);
    expect(logged.join("\n")).toMatch(/not the one this id registered with/);
  });

  it("tells a LAPSED engine from a wrong token on select", async () => {
    const gone = await post("/engine/select", { id: "nobody", token: "t" });
    expect(gone.status).toBe(404);
    expect(String(gone.body.error)).toMatch(/engine gone.*heartbeat/);

    await post("/registry/heartbeat", good());
    const wrong = await post("/engine/select", { id: "e1", token: "nope" });
    expect(wrong.status).toBe(403);
    expect(String(wrong.body.error)).toMatch(/bad token/);

    const right = await post("/engine/select", { id: "e1", token: "tok-e1" });
    expect(right.status).toBe(200);
    expect(logged.join("\n")).toMatch(/select of engine nobody refused/);
  });
});
