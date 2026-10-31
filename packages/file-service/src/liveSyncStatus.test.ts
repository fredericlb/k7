// liveSyncStatus.test.ts — where each workspace lives on a machine, against a fake server's room list: the active
// server's rooms only, and nothing on a server.

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
    expect(s.workspaces).toEqual([
      { name: "band", state: "local", server },
      { name: "solo", state: "local", server },
      { name: "gig", state: "server", server },
    ]);
  });

  it("lists the active server's rooms only, by its token, whatever another saved server holds", async () => {
    const url = `ws://127.0.0.1:${port}/api/sync`;
    process.env.STUDIO_SYNC_URL = url;
    process.env.STUDIO_SYNC_TOKEN = "band-token";
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url, token: "band-token", main: true, id: "band", as: "band@x" },
    ]);
    process.env.STUDIO_SYNC_HIDDEN = JSON.stringify([
      { id: "mine", url, home: true },
    ]);
    // The band's `gig` was brought down here as `gig.band`: its record names the band's link.
    writeLinkRecord(liveLogFor(workspaceRoot("gig.band")), {
      server: `http://127.0.0.1:${port}`,
      link: "band",
      room: "gig",
    });
    const s = await workspaceSyncStatus(["gig.band"]);
    expect(auth).toBe("Bearer band-token");
    const server = `http://127.0.0.1:${port}`;
    expect(s.workspaces).toEqual([
      { name: "gig.band", state: "local", server, room: "gig" },
      { name: "setlist", state: "server", server },
    ]);
    delete process.env.STUDIO_SYNC_HIDDEN;
  });

  it("says nothing on a server: it is the server", async () => {
    const own = `ws://127.0.0.1:${port}/api/sync`;
    delete process.env.STUDIO_SYNC_TOKEN;
    process.env.STUDIO_SYNC_URL = own;
    process.env.STUDIO_HUB_SECRET = "hs";
    delete process.env.STUDIO_SYNC_SERVERS;
    expect((await workspaceSyncStatus(["band"])).paired).toBe(false);
  });
});
