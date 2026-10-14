// syncEnd.test.ts — deleting a workspace ENDS it for sync, over a real relay: its room is emptied and off the
// server's list, so no replica joins it again, and another device synced with it lets its copy go — unless that
// copy holds a file sync never knew. See file-service docs/liveCapture.md and docs/workspaces.md.

// The file service's own request fields, which its liveSync.ts reaches through the modules it loads.
/// <reference path="../file-service/src/types/express.d.ts" />

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LiveCapture } from "@studio/file-service/src/liveCapture.ts";
import { loadHead, RelayLink } from "@studio/file-service/src/liveRelay.ts";
import { isBinary, skip } from "@studio/file-service/src/workspaceFilter.ts";
import { Replica } from "@studio/live-sync/replica";
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

describe("deleting a synced workspace", () => {
  it("empties its room, takes it off the list, and ends it on the other device", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "syncend-data-"));
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
    const url = `ws://127.0.0.1:${port}${SYNC_PATH}`;
    const rooms = async () =>
      (
        (await (
          await fetch(`http://127.0.0.1:${port}/api/sync/rooms`, {
            headers: {
              authorization: `Bearer ${tokens.mint("acct", "x").token}`,
            },
          })
        ).json()) as { workspaces: string[] }
      ).workspaces;

    // The machine the deletion is made on: wired as the file service wires it.
    const home = mkdtempSync(join(tmpdir(), "syncend-home-"));
    process.env.STUDIO_HOME = home;
    process.env.STUDIO_SYNC_URL = url;
    process.env.STUDIO_SYNC_TOKEN = tokens.mint("acct", "laptop").token;
    delete process.env.STUDIO_SYNC_SERVERS;
    const live = await import("@studio/file-service/src/liveSync.ts");
    const { workspaceRoot } = await import("@studio/file-service/src/slug.ts");
    const root = workspaceRoot("band");
    put(root, "song.k7/project.yaml", "project:\n  name: song\n");
    const ws = {
      root,
      invalidateProjectDoc: () => {},
      activeProjectPath: () => null,
    } as unknown as Parameters<typeof live.attachLiveCapture>[0];
    live.attachLiveCapture(ws, "band");
    await until(() => relay.room("acct", "band").room.files.size === 1);
    expect(await rooms()).toEqual(["band"]);

    // Another device, synced with the same room, that hears when it ends.
    const other = mkdtempSync(join(tmpdir(), "syncend-other-"));
    const otherLog = mkdtempSync(join(tmpdir(), "syncend-otherlog-"));
    const link = new RelayLink(
      url,
      { token: tokens.mint("acct", "phone").token },
      () => {},
    );
    const capture = new LiveCapture({
      root: other,
      replica: "phone",
      skip,
      isBinary,
      onBatch: (b) => link.local("band", b),
      quietMs: 30,
      reconcileMs: 0,
    });
    const replica = new Replica(
      "phone",
      {
        read: (f) => capture.read(f),
        write: (f, t) => capture.writeKnown(f, t),
      },
      undefined,
      loadHead(otherLog),
    );
    let ended = false;
    link.add(
      {
        name: "band",
        capture,
        replica,
        written: [],
        onRemote: () => {},
        onEnded: () => {
          ended = true;
        },
      },
      otherLog,
    );
    capture.start();
    cleanup.push(() => {
      link.close();
      capture.stop();
    });
    await until(() => existsSync(join(other, "song.k7/project.yaml")));

    await live.endWorkspace(root);

    // Emptied, and off the list: nothing joins it again, so it cannot come back empty.
    expect(relay.room("acct", "band").room.files.size).toBe(0);
    expect(await rooms()).toEqual([]);
    expect(live.attachedAt(root)).toBeUndefined();
    // The other device heard it end, its copy of the file gone with the room's.
    await until(() => ended);
    expect(existsSync(join(other, "song.k7/project.yaml"))).toBe(false);
  }, 60_000);
});

describe("a workspace ended elsewhere", () => {
  it("lets an emptied folder go, and keeps one holding a file sync never knew", async () => {
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "syncend-drop-"));
    const { workspaceRoot } = await import("@studio/file-service/src/slug.ts");
    const { dropEndedWorkspace } = await import(
      "@studio/file-service/src/workspaces.ts"
    );
    const empty = workspaceRoot("gone");
    mkdirSync(join(empty, "song.k7/clips"), { recursive: true });
    await dropEndedWorkspace("gone");
    expect(existsSync(empty)).toBe(false);

    const kept = workspaceRoot("kept");
    put(kept, ".k7x-backup/old.yaml", "x: 1\n");
    await dropEndedWorkspace("kept");
    expect(existsSync(kept)).toBe(true);
  });
});
