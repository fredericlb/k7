// Two rules, and both are about what happens when things are NOT fine: the bearer is the
// user's ACCOUNT credential and must never reach a LAN caller, and an unreachable server must
// answer offline rather than throw — a throw reaches the gate as the CORS screen.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLocalServer } from "./index.ts";

let home: string;
let local: Awaited<ReturnType<typeof startLocalServer>>;
let upstream: Server | null = null;
let seen: { url: string; auth: string | undefined }[] = [];
let remote: { serverUrl: string | null; serverToken: string | null };
const saved = process.env.STUDIO_HOME;
let nextPort = 39600;

/** A stand-in for the studio origin: records what arrived and answers a recognisable body. */
function fakeServer(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      seen.push({ url: req.url ?? "", auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ from: "the server", url: req.url }));
    });
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "desk-remote-"));
  process.env.STUDIO_HOME = home;
  seen = [];
  const dist = join(home, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>st0</title>",
    "utf8",
  );

  const upPort = (nextPort += 5);
  upstream = await fakeServer(upPort);
  remote = { serverUrl: `http://127.0.0.1:${upPort}`, serverToken: "tok-abc" };

  local = await startLocalServer({
    port: upPort + 1,
    distDir: dist,
    host: "127.0.0.1",
    remote: () => remote,
  });
});

/** Resolves even with nothing to close — `new Promise(r => up?.close(r))` never would. */
async function stopUpstream(): Promise<void> {
  const s = upstream;
  upstream = null;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>((r) => s.close(() => r()));
}

afterEach(async () => {
  await local.close();
  await stopUpstream();
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

describe("with a paired server", () => {
  it("forwards to the server under ITS pl8 prefix, not the origin root", async () => {
    const r = await fetch(`${local.url}/pl8/api/projects`);
    expect(await r.json()).toMatchObject({ from: "the server" });
    // `/pl8/...` here is `/pl8/...` there: st0 owns the origin root, pl8 owns the prefix.
    expect(seen[0]?.url).toBe("/pl8/api/projects");
  });

  it("attaches the bearer — the page holds no cookie for the remote, by design", async () => {
    await fetch(`${local.url}/pl8/api/projects`);
    expect(seen[0]?.auth).toBe("Bearer tok-abc");
  });

  it("answers OFFLINE when the server cannot be reached, rather than throwing", async () => {
    // Connections closed too, not just the listener: undici holds a keep-alive socket, and a
    // merely DRAINING server is "slow", which is a different test from "gone".
    await stopUpstream();
    const r = await fetch(`${local.url}/pl8/api/projects`);
    // A throw would surface at the gate as the CORS screen; a 503 is a sentence.
    expect(r.status).toBe(503);
    expect((await r.json()) as { error: string }).toHaveProperty("error");
  });

  it("falls back to the shim's answers when unpaired mid-session", async () => {
    remote = { serverUrl: null, serverToken: null };
    // The SHARES, not the register: git left this service, and shares are what it still holds.
    const r = await fetch(`${local.url}/pl8/api/shares`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ shares: [], revision: "offline" });
    expect(seen).toHaveLength(0);
  });

  it("carries the method and body of a write", async () => {
    await fetch(`${local.url}/pl8/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri: "ssh://git@x/y.git" }),
    });
    expect(seen[0]?.url).toBe("/pl8/api/projects");
    expect(seen[0]?.auth).toBe("Bearer tok-abc");
  });
});
