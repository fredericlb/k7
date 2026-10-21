// syncPairing.test.ts — a hub where pairing is off refuses to pair an account, and reads none it finds on disk.

import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { accountKey } from "./instances.ts";
import { writeRemote } from "./syncRemote.ts";
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
  it("on a server, stores a pairing as a secondary and never makes one main", async () => {
    const { call, restarted } = await start(false);
    const pair = { url: "wss://band.test/api/sync", token: "t", main: true };
    expect((await call("PUT", pair)).status).toBe(200);
    expect((await call("POST", { url: pair.url }, "/main")).status).toBe(403);
    expect((await call("DELETE")).status).toBe(200);
    expect(restarted).toEqual([USER, USER]);
  });

  it("on a server, lists itself first as the main one, and no surface follows a pairing", async () => {
    const { call, dataRoot, routes, port } = await start(false);
    const home = join(dataRoot, accountKey(USER));
    mkdirSync(home, { recursive: true });
    const url = "wss://x.test/api/sync";
    writeRemote(home, { url, token: "t", user: USER, main: true });
    const own = `ws://127.0.0.1:${port}/api/sync`;
    expect(await (await call("GET")).json()).toEqual({
      paired: true,
      url: own,
      servers: [
        { url: own, main: true, own: true },
        { url, main: false },
      ],
    });
    const req = { headers: { "x-test-session": USER } } as never;
    expect(routes.remoteOf(req)).toBeNull();
  });

  it("pairs where it is on", async () => {
    const { call, restarted } = await start(true);
    const pair = { url: "wss://origin.test/api/sync", token: "t" };
    expect((await call("PUT", pair)).status).toBe(200);
    expect(restarted).toEqual([USER]);
  });
});
