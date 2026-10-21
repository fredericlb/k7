// liveSyncStatus.test.ts — where each workspace lives on a paired machine, against a fake server's room list.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceSyncStatus } from "./liveSync.ts";

let server: Server;
let port = 0;
let auth = "";
const saved = { ...process.env };

beforeAll(async () => {
  server = createServer((req, res) => {
    auth = String(req.headers.authorization ?? "");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ workspaces: ["band", "gig", "Examples"] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
  process.env = { ...saved };
});

describe("workspaceSyncStatus", () => {
  it("says nothing on a machine that is not paired: every workspace is simply here", async () => {
    delete process.env.STUDIO_SYNC_TOKEN;
    process.env.STUDIO_SYNC_URL = `ws://127.0.0.1:${port}/api/sync`;
    expect(await workspaceSyncStatus(["band"])).toEqual({
      paired: false,
      server: null,
      workspaces: [],
    });
  });

  it("on a paired machine, lists the server's workspaces it lacks, and never Examples", async () => {
    process.env.STUDIO_SYNC_URL = `ws://127.0.0.1:${port}/api/sync`;
    process.env.STUDIO_SYNC_TOKEN = "device-token";
    const s = await workspaceSyncStatus(["band", "solo", "Examples"]);
    expect(auth).toBe("Bearer device-token");
    expect(s.paired).toBe(true);
    expect(s.server).toBe(`http://127.0.0.1:${port}`);
    // Neither is captured in this test, so neither has joined its room yet: here only, until it has.
    const server = `http://127.0.0.1:${port}`;
    expect(s.servers).toEqual([{ origin: server, main: true }]);
    expect(s.workspaces).toEqual([
      { name: "band", state: "local", server },
      { name: "solo", state: "local", server },
      { name: "gig", state: "server", server },
    ]);
  });

  it("on a server, says nothing until another server is added beside its own relay, then names itself as the page does", async () => {
    const own = `ws://127.0.0.1:${port}/api/sync`;
    delete process.env.STUDIO_SYNC_TOKEN;
    process.env.STUDIO_SYNC_URL = own;
    process.env.STUDIO_HUB_SECRET = "hs";
    delete process.env.STUDIO_SYNC_SERVERS;
    expect(
      (await workspaceSyncStatus(["band"], "https://home.test")).paired,
    ).toBe(false);
    // The same fake answers the secondary, under another host.
    const band = `ws://localhost:${port}/api/sync`;
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url: own, own: true, main: true },
      { url: band, token: "tb", main: false },
    ]);
    const s = await workspaceSyncStatus(["band"], "https://home.test");
    expect(s.paired).toBe(true);
    expect(s.server).toBe("https://home.test");
    expect(s.servers).toEqual([
      { origin: "https://home.test", main: true },
      { origin: `http://localhost:${port}`, main: false },
    ]);
    expect(s.workspaces).toContainEqual({
      name: "band",
      state: "local",
      server: "https://home.test",
    });
    expect(s.workspaces).toContainEqual({
      name: "gig",
      state: "server",
      server: `http://localhost:${port}`,
    });
  });
});
