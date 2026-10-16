// syncRooms.test.ts — a SERVER's own replica joins a workspace a device created after it connected: one seeded
// there, or landed by a move, which no reconnect announces. Its home page lists it. See file-service docs/workspaces.md.

// The file service's own request fields, which its liveSync.ts reaches through the modules it loads.
/// <reference path="../file-service/src/types/express.d.ts" />

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveCapture } from "@studio/file-service/src/liveCapture.ts";
import { loadHead, RelayLink } from "@studio/file-service/src/liveRelay.ts";
import { isBinary, skip } from "@studio/file-service/src/workspaceFilter.ts";
import { Replica } from "@studio/live-sync/replica";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { DeviceTokens } from "./deviceTokens.ts";
import { roomsRouter } from "./roomsRoute.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

const SECRET = "hub-secret";
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

describe("a server's own replica", () => {
  it("joins a workspace a device created after it connected", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "syncrooms-data-"));
    const tokens = new DeviceTokens(Buffer.from("key"), (slug) =>
      join(dataRoot, slug),
    );
    const accountOf = async (c: { secret?: string; token?: string }) =>
      c.token
        ? (tokens.verify(c.token)?.slug ?? null)
        : c.secret === SECRET
          ? "acct"
          : null;
    const app = express();
    const server: Server = createServer(app);
    const relay = attachSyncRelay(server, {
      accountDir: (slug) => join(dataRoot, slug),
      accountOf: async (s) => accountOf({ secret: s }),
      deviceOf: (t) => tokens.verify(t)?.slug ?? null,
      log: () => {},
    });
    app.use(
      "/api/sync/rooms",
      roomsRouter({
        accountDir: (slug) => join(dataRoot, slug),
        accountOf,
        holdsFiles: (slug, ws) => relay.room(slug, ws).room.files.size > 0,
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    cleanup.push(() => {
      relay();
      server.close();
      server.closeAllConnections();
    });
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;

    // The server's own file service: the hub's secret, no device token.
    const home = mkdtempSync(join(tmpdir(), "syncrooms-home-"));
    process.env.STUDIO_HOME = home;
    process.env.STUDIO_SYNC_URL = url;
    process.env.STUDIO_HUB_SECRET = SECRET;
    delete process.env.STUDIO_SYNC_TOKEN;
    delete process.env.STUDIO_SYNC_SERVERS;
    writeFileSync(join(home, "owner.json"), '{ "owner": "me@example.org" }\n');
    const live = await import("@studio/file-service/src/liveSync.ts");
    const { workspaceRoot } = await import("@studio/file-service/src/slug.ts");

    // A device seeds "gig", which the server has never heard of.
    const device = mkdtempSync(join(tmpdir(), "syncrooms-device-"));
    mkdirSync(join(device, "song.k7"), { recursive: true });
    writeFileSync(
      join(device, "song.k7/project.yaml"),
      "project:\n  name: s\n",
    );
    const log = mkdtempSync(join(tmpdir(), "syncrooms-log-"));
    const link = new RelayLink(
      url,
      { token: tokens.mint("acct", "laptop").token },
      () => {},
    );
    const capture = new LiveCapture({
      root: device,
      replica: "laptop",
      skip,
      isBinary,
      onBatch: (b) => link.local("gig", b),
      quietMs: 30,
      reconcileMs: 0,
    });
    const replica = new Replica(
      "laptop",
      {
        read: (f) => capture.read(f),
        write: (f, t) => capture.writeKnown(f, t),
      },
      undefined,
      loadHead(log),
    );
    link.add(
      { name: "gig", capture, replica, written: [], onRemote: () => {} },
      log,
    );
    capture.start();
    cleanup.push(() => {
      link.close();
      capture.stop();
    });
    await until(() => relay.room("acct", "gig").room.files.size === 1);

    await live.joinServerRooms();
    const root = workspaceRoot("gig");
    await until(() => existsSync(join(root, "song.k7/project.yaml")));
    expect(live.attachedAt(root)?.room).toBe("gig");
  }, 60_000);
});
