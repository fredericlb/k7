// syncMove.test.ts — a workspace moved between two servers a device is paired with, over two real relays and blob
// stores: the target holds it whole, its audio's bytes included, the room it left is empty — off that server's
// list — and the workspace syncs with the target from then on. See file-service docs/liveCapture.md, "Several servers".

// The file service's own request fields, which its liveSync.ts reaches through the modules it loads.
/// <reference path="../file-service/src/types/express.d.ts" />

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseBlobRef } from "@studio/live-sync/blob";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { blobsRouter } from "./blobStore.ts";
import { DeviceTokens } from "./deviceTokens.ts";
import { roomsRouter } from "./roomsRoute.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

const cleanup: (() => void)[] = [];
afterAll(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

async function until(f: () => boolean, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** One server: its relay, its blob store and its room list, and a device token for the account. */
async function hub(name: string) {
  const dataRoot = mkdtempSync(join(tmpdir(), `syncmove-${name}-`));
  const tokens = new DeviceTokens(Buffer.from(`key-${name}`), (slug) =>
    join(dataRoot, slug),
  );
  const accountOf = async (c: { secret?: string; token?: string }) =>
    c.token ? (tokens.verify(c.token)?.slug ?? null) : null;
  const app = express();
  app.use(
    "/api/sync/blobs",
    blobsRouter({ accountDir: (slug) => join(dataRoot, slug), accountOf }),
  );
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
  const port = (server.address() as AddressInfo).port;
  const { token } = tokens.mint("acct", "laptop");
  return {
    url: `ws://127.0.0.1:${port}${SYNC_PATH}`,
    origin: `http://127.0.0.1:${port}`,
    token,
    files: (ws: string) => relay.room("acct", ws).room.files,
  };
}

describe("moving a workspace between two servers", () => {
  it("lands whole on the target and leaves the room it left empty", async () => {
    const a = await hub("a");
    const b = await hub("b");
    const home = mkdtempSync(join(tmpdir(), "syncmove-home-"));
    process.env.STUDIO_HOME = home;
    process.env.STUDIO_SYNC_URL = a.url;
    process.env.STUDIO_SYNC_TOKEN = a.token;
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url: a.url, token: a.token, main: true },
      { url: b.url, token: b.token, main: false },
    ]);
    // Imported once the environment says which servers there are.
    const live = await import("@studio/file-service/src/liveSync.ts");
    const move = await import("@studio/file-service/src/liveMove.ts");

    // Where the service keeps a workspace, which is where its list looks for it.
    const { workspaceRoot } = await import("@studio/file-service/src/slug.ts");
    const root = workspaceRoot("band");
    const take = randomBytes(80_000);
    const put = (rel: string, data: string | Buffer) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), data);
    };
    put("song.k7/project.yaml", "project:\n  name: song\n");
    put("song.k7/clips/take.wav", take);
    const ws = {
      root,
      invalidateProjectDoc: () => {},
      activeProjectPath: () => null,
    } as unknown as Parameters<typeof live.attachLiveCapture>[0];
    live.attachLiveCapture(ws, "band");
    cleanup.push(() => live.detachLiveCapture(root));

    // Synced with A, the main one, bytes included.
    await until(() => a.files("band").has("song.k7/clips/take.wav"));
    await until(() => {
      const at = live.attachedAt(root);
      return (
        !!at?.replica &&
        at.replica.unconfirmed().length === 0 &&
        at.link?.textState("band") === "current"
      );
    });

    await move.startMove(root, b.origin);
    await until(() => move.moveState(root) === undefined, 60_000);

    // B holds it whole, and the take's bytes are on B's store.
    expect([...b.files("band").keys()].sort()).toEqual([
      "song.k7/clips/take.wav",
      "song.k7/project.yaml",
    ]);
    const ref = parseBlobRef(
      b.files("band").get("song.k7/clips/take.wav") ?? "",
    );
    expect(ref?.size).toBe(take.length);
    const head = await fetch(`${b.origin}/api/sync/blobs/${ref?.hash}`, {
      method: "HEAD",
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(head.status).toBe(200);
    // …and A's room is empty: off A's list, for every device synced with A.
    expect(a.files("band").size).toBe(0);

    // The workspace syncs with B from now on, and the list says so.
    expect(live.attachedAt(root)?.server?.url).toBe(b.url);
    const status = await live.workspaceSyncStatus(["band"]);
    expect(status.workspaces).toEqual([
      { name: "band", state: "synced", server: b.origin },
    ]);

    // An edit made after the move reaches B.
    put("song.k7/notes.yaml", "notes: after the move\n");
    await until(() => b.files("band").has("song.k7/notes.yaml"));
    expect(a.files("band").size).toBe(0);
  }, 120_000);
});
