// The origin's contract, checked by talking to a real listening server. What matters here is
// not that express works, but that the two rules st0's frontend leans on hold: EVERY unknown
// path answers index.html (it reads `/external` and `/@local/…` from the address before its
// router runs), and index.html is never cached (after an upgrade the window would show the
// previous build, and two reloads would "fix" it — which reads as the build not having run).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLocalServer } from "./index.ts";
import { isLoopback } from "./origin.ts";
import { firstFreePort } from "./port.ts";

let home: string;
let dist: string;
let server: Awaited<ReturnType<typeof startLocalServer>> | null = null;
const saved = process.env.STUDIO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "desk-srv-"));
  process.env.STUDIO_HOME = home;
  dist = join(home, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>st0</title>",
    "utf8",
  );
  writeFileSync(join(dist, "assets", "app-abc123.js"), "// hashed", "utf8");
});

afterEach(async () => {
  await server?.close();
  server = null;
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

// A port of its own per test: fixed ports are the app's contract, not the suite's, and a
// server closing in the background would otherwise decide which one the next test got.
let nextPort = 39800;
const start = async () => {
  server = await startLocalServer({
    port: (nextPort += 3),
    distDir: dist,
    host: "127.0.0.1",
  });
  return server;
};

describe("the local origin", () => {
  it("serves st0 at the root", async () => {
    const { url } = await start();
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>st0</title>");
  });

  it("answers index.html for EVERY unknown path — /external and /@local are read from the address", async () => {
    const { url } = await start();
    for (const path of [
      "/external",
      "/@local/Examples/synth-demo.st0",
      "/songs/first.st0/timeline",
    ]) {
      const r = await fetch(`${url}${path}`);
      expect(r.status, path).toBe(200);
      expect(await r.text(), path).toContain("<title>st0</title>");
    }
  });

  it("does not cache index.html, and does cache a hashed asset", async () => {
    const { url } = await start();
    expect((await fetch(url)).headers.get("cache-control")).toContain(
      "no-cache",
    );
    const asset = await fetch(`${url}/assets/app-abc123.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");
  });

  it("lets a real file win over the catch-all", async () => {
    const { url } = await start();
    expect(await (await fetch(`${url}/assets/app-abc123.js`)).text()).toBe(
      "// hashed",
    );
  });

  it("mounts the engine registry on its own origin", async () => {
    const { url } = await start();
    const r = await fetch(`${url}/api/engines`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it("advertises itself as `studio-desktop`, not `st0` — two writers would take turns", async () => {
    const { url } = await start();
    const { readFileSync } = await import("node:fs");
    const file = join(home, "web-endpoints", "studio-desktop.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      service: "studio-desktop",
      url,
    });
  });

  it("moves off a held port rather than failing to start", async () => {
    const port = (nextPort += 3);
    const first = await startLocalServer({
      port,
      distDir: dist,
      host: "127.0.0.1",
    });
    const second = await startLocalServer({
      port,
      distDir: dist,
      host: "127.0.0.1",
    });
    try {
      expect(second.port).toBeGreaterThan(first.port);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("finds the port it was asked for when nothing holds it", async () => {
    const port = (nextPort += 3);
    expect(await firstFreePort(port)).toBe(port);
  });
});

describe("the loopback guard", () => {
  it("accepts this machine, in either address family", () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopback({ socket: { remoteAddress: a } } as never), a).toBe(
        true,
      );
    }
  });

  it("refuses the LAN — a peer riding the pl8 proxy would have the account", () => {
    for (const a of [
      "192.168.1.20",
      "10.0.0.5",
      "::ffff:192.168.1.20",
      undefined,
    ]) {
      expect(
        isLoopback({ socket: { remoteAddress: a } } as never),
        String(a),
      ).toBe(false);
    }
  });
});
