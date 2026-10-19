// syncRename.test.ts — a workspace kept here as `room.host`, while another server's workspace held its name, takes
// its room's name back once that is free: the folder, its sync history and its link move together, and it goes
// on syncing as the same room. See file-service docs/liveCapture.md, "Several servers".

// The file service's own request fields, which its liveSync.ts reaches through the modules it loads.
/// <reference path="../file-service/src/types/express.d.ts" />

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { DeviceTokens } from "./deviceTokens.ts";
import { roomsRouter } from "./roomsRoute.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

const cleanup: (() => void)[] = [];
afterAll(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

async function until(f: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const put = (root: string, rel: string, data: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), data);
};

describe("a workspace named after its server", () => {
  it("takes its room's name back once that is free, and goes on syncing", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "syncrename-data-"));
    const tokens = new DeviceTokens(Buffer.from("key"), (slug) =>
      join(dataRoot, slug),
    );
    const app = express();
    const server: Server = createServer(app);
    const relay = attachSyncRelay(server, {
      accountDir: (slug) => join(dataRoot, slug),
      accountOf: async () => null,
      deviceOf: (t) => tokens.verify(t)?.slug ?? null,
      log: () => {},
    });
    app.use(
      "/api/sync/rooms",
      roomsRouter({
        accountDir: (slug) => join(dataRoot, slug),
        accountOf: async (c) =>
          c.token ? (tokens.verify(c.token)?.slug ?? null) : null,
        holdsFiles: (slug, ws) => relay.room(slug, ws).room.files.size > 0,
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    cleanup.push(() => {
      relay();
      server.close();
      server.closeAllConnections();
    });
    const port = (server.address() as AddressInfo).port;

    const home = mkdtempSync(join(tmpdir(), "syncrename-home-"));
    process.env.STUDIO_HOME = home;
    process.env.STUDIO_SYNC_URL = `ws://127.0.0.1:${port}${SYNC_PATH}`;
    process.env.STUDIO_SYNC_TOKEN = tokens.mint("acct", "laptop").token;
    delete process.env.STUDIO_SYNC_SERVERS;
    writeFileSync(join(home, "owner.json"), '{ "owner": "me@example.org" }\n');
    const { workspaceRoot } = await import("@studio/file-service/src/slug.ts");
    const { liveLogFor } = await import("@studio/file-service/src/liveLog.ts");
    const servers = await import("@studio/file-service/src/liveServers.ts");
    const live = await import("@studio/file-service/src/liveSync.ts");
    const ws = await import("@studio/file-service/src/workspaces.ts");

    // Brought down as `band.other` while another server's `band` held the name here; its room is `band`.
    const old = workspaceRoot("band.other");
    put(old, "song.k7/project.k7x", 'project({ name: "s" })\n');
    servers.writeLinkRecord(liveLogFor(old), {
      server: `http://127.0.0.1:${port}`,
      room: "band",
    });
    ws.joinWorkspace("band.other");
    await until(() => relay.room("acct", "band").room.files.size === 1);

    expect(await ws.restoreRoomName("band.other")).toBe("band");
    const root = workspaceRoot("band");
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(root, "song.k7/project.k7x"))).toBe(true);
    // Its history moved with it, and it is the same room, linked again.
    expect(servers.readLinkRecord(liveLogFor(root))?.room).toBe("band");
    await until(
      () => live.attachedAt(root)?.link?.textState("band") === "current",
    );

    // An edit under the new name reaches the room; nothing was sent as removed and added again.
    put(root, "song.k7/notes.k7x", 'notes("renamed")\n');
    await until(() =>
      relay.room("acct", "band").room.files.has("song.k7/notes.k7x"),
    );
    expect(
      relay.room("acct", "band").room.files.has("song.k7/project.k7x"),
    ).toBe(true);
    live.detachLiveCapture(root);
  }, 60_000);
});
