// syncPairing.test.ts — a server saves no server and reads none it finds on disk; a machine saves them, one active.

import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { accountKey } from "./instances.ts";
import { linkId, writeRemote } from "./syncRemote.ts";
import { type SyncContext, SyncRoutes } from "./syncRoutes.ts";

const USER = "eve@example.com";
let server: Server | null = null;

async function start(remotePairing: boolean) {
  const dataRoot = mkdtempSync(join(tmpdir(), "sync-pairing-"));
  const restarted: string[] = [];
  const routes = new SyncRoutes({
    dataRoot,
    librariesHome: join(dataRoot, "_libraries"),
    librarySecret: "s",
    devices: {} as SyncContext["devices"],
    instances: {
      restart: async (u: string) => void restarted.push(u),
    } as unknown as SyncContext["instances"],
    userOf: (req) => String(req.headers["x-test-session"] ?? ""),
    subjectOf: () => "",
    relay: () => null,
    remotePairing,
  });
  const app = express();
  app.use("/api/sync/remote", routes.remoteRouter());
  server = createServer(app);
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, body?: unknown, path = "") =>
    fetch(`http://127.0.0.1:${port}/api/sync/remote${path}`, {
      method,
      headers: { "x-test-session": USER, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { dataRoot, routes, call, restarted, port };
}

afterEach(async () => {
  await new Promise((r) => server?.close(r));
  server = null;
});

describe("remote pairing", () => {
  it("on a server, saves no server, lists none, and no surface follows a pairing on disk", async () => {
    const { call, dataRoot, routes, restarted } = await start(false);
    const pair = { url: "wss://band.test/api/sync", token: "t" };
    expect((await call("PUT", pair)).status).toBe(403);
    expect((await call("POST", { url: pair.url }, "/active")).status).toBe(403);
    const home = join(dataRoot, accountKey(USER));
    mkdirSync(home, { recursive: true });
    writeRemote(home, { url: "wss://x.test/api/sync", token: "t", user: USER });
    expect(await (await call("GET")).json()).toEqual({
      paired: false,
      url: null,
      as: null,
      servers: [],
    });
    const req = { headers: { "x-test-session": USER } } as never;
    expect(routes.remoteOf(req)).toBeNull();
    expect(restarted).toEqual([]);
  });

  it("on a machine, saves a server as the active one, and switches between the saved ones", async () => {
    const { call, routes, restarted } = await start(true);
    const a = "wss://a.test/api/sync";
    const b = "wss://b.test/api/sync";
    expect((await call("PUT", { url: a, token: "ta" })).status).toBe(200);
    expect((await call("PUT", { url: b, token: "tb" })).status).toBe(200);
    const req = { headers: { "x-test-session": USER } } as never;
    expect(routes.remoteOf(req)?.token).toBe("tb");
    const listed = (await (await call("GET")).json()) as {
      url: string;
      servers: { id: string; active: boolean }[];
    };
    expect(listed.url).toBe(b);
    expect(listed.servers.map((s) => [s.id, s.active])).toEqual([
      [linkId(b, USER), true],
      [linkId(a, USER), false],
    ]);
    expect(
      (await call("POST", { id: linkId(a, USER) }, "/active")).status,
    ).toBe(200);
    expect(routes.remoteOf(req)?.token).toBe("ta");
    expect((await call("POST", { id: "nope" }, "/active")).status).toBe(404);
    expect(restarted).toEqual([USER, USER, USER]);
  });
});
