// liveSyncStatus.test.ts — where each workspace lives on a paired machine, against a fake server's room list.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceSyncStatus } from "./liveSync.ts";

let server: Server;
let port = 0;
let auth = "";
const saved = {
  url: process.env.STUDIO_SYNC_URL,
  token: process.env.STUDIO_SYNC_TOKEN,
};

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
  process.env.STUDIO_SYNC_URL = saved.url;
  if (saved.token === undefined) delete process.env.STUDIO_SYNC_TOKEN;
  else process.env.STUDIO_SYNC_TOKEN = saved.token;
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
    expect(s.workspaces).toEqual([
      { name: "band", state: "local" },
      { name: "solo", state: "local" },
      { name: "gig", state: "server" },
    ]);
  });
});
