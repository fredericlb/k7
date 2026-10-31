// liveSyncStatus.test.ts — where each workspace lives on a paired machine, against a fake server's room list, and
// two accounts linked on that one server, each listing its own rooms.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveLogFor } from "./liveLog.ts";
import { writeLinkRecord } from "./liveServers.ts";
import { workspaceSyncStatus } from "./liveSync.ts";
import { workspaceRoot } from "./slug.ts";

let server: Server;
let port = 0;
let auth = "";
const saved = { ...process.env };

beforeAll(async () => {
  process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "sync-status-"));
  server = createServer((req, res) => {
    auth = String(req.headers.authorization ?? "");
    res.setHeader("content-type", "application/json");
    // The band's account on this server holds other rooms than the person's own.
    const workspaces = auth.endsWith("band-token")
      ? ["gig", "setlist"]
      : ["band", "gig", "Examples"];
    res.end(JSON.stringify({ workspaces }));
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
    delete process.env.STUDIO_SYNC_SERVERS;
    const s = await workspaceSyncStatus(["band", "solo", "Examples"]);
    expect(auth).toBe("Bearer device-token");
    expect(s.paired).toBe(true);
    expect(s.server).toBe(`http://127.0.0.1:${port}`);
    // Neither is captured in this test, so neither has joined its room yet: here only, until it has.
    const server = `http://127.0.0.1:${port}`;
    const link = `127.0.0.1:${port}`;
    expect(s.servers).toEqual([{ origin: server, main: true, id: link }]);
    expect(s.workspaces).toEqual([
      { name: "band", state: "local", server, link },
      { name: "solo", state: "local", server, link },
      { name: "gig", state: "server", server, link },
    ]);
  });

  it("with two accounts on one server, lists each one's rooms under its own link", async () => {
    const url = `ws://127.0.0.1:${port}/api/sync`;
    process.env.STUDIO_SYNC_URL = url;
    process.env.STUDIO_SYNC_TOKEN = "device-token";
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      {
        url,
        token: "device-token",
        main: true,
        id: "mine",
        as: "me@x",
        home: true,
      },
      { url, token: "band-token", main: false, id: "band", as: "band@x" },
    ]);
    // The band's `gig` was brought down here: its record names the band's link.
    writeLinkRecord(liveLogFor(workspaceRoot("gig.band")), {
      server: `http://127.0.0.1:${port}`,
      link: "band",
      room: "gig",
    });
    const s = await workspaceSyncStatus(["band", "gig.band"]);
    const server = `http://127.0.0.1:${port}`;
    expect(s.servers).toEqual([
      { origin: server, main: true, id: "mine", as: "me@x" },
      { origin: server, main: false, id: "band", as: "band@x" },
    ]);
    expect(s.workspaces).toEqual([
      { name: "band", state: "local", server, link: "mine" },
      {
        name: "gig.band",
        state: "local",
        server,
        link: "band",
        room: "gig",
      },
      // The person's own `gig` is not here, whatever the band's is.
      { name: "gig", state: "server", server, link: "mine" },
      { name: "setlist", state: "server", server, link: "band" },
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
      { url: own, own: true, main: true, id: "own", home: true },
      { url: band, token: "tb", main: false, id: "b", home: true },
    ]);
    const s = await workspaceSyncStatus(["band"], "https://home.test");
    expect(s.paired).toBe(true);
    expect(s.server).toBe("https://home.test");
    expect(s.servers).toEqual([
      { origin: "https://home.test", main: true, id: "own" },
      { origin: `http://localhost:${port}`, main: false, id: "b" },
    ]);
    expect(s.workspaces).toContainEqual({
      name: "band",
      state: "local",
      server: "https://home.test",
      link: "own",
    });
    expect(s.workspaces).toContainEqual({
      name: "gig",
      state: "server",
      server: `http://localhost:${port}`,
      link: "b",
    });
  });
});
