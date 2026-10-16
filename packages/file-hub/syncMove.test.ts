// syncMove.test.ts — a workspace moved or copied between two servers a device is paired with, over two real relays
// and blob stores: the target holds it whole, its audio's bytes included. A move empties the room it left and syncs
// with the target from then on; a copy leaves it synced where it was. See file-service docs/liveCapture.md.

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

/** Two servers, the device paired with both and A its main one; the modules loaded once the environment says so. */
const servers = (async () => {
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
  const live = await import("@studio/file-service/src/liveSync.ts");
  const move = await import("@studio/file-service/src/liveMove.ts");
  const { workspaceRoot } = await import("@studio/file-service/src/slug.ts");
  return { a, b, live, move, workspaceRoot };
})();

/** Workspace `name` with a song and a take, captured and synced with A, bytes included. */
async function syncedOnA(name: string) {
  const { a, live, workspaceRoot } = await servers;
  // Where the service keeps a workspace, which is where its list looks for it.
  const root = workspaceRoot(name);
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
  live.attachLiveCapture(ws, name);
  cleanup.push(() => live.detachLiveCapture(root));
  await until(() => a.files(name).has("song.k7/clips/take.wav"));
  await until(() => {
    const at = live.attachedAt(root);
    return (
      !!at?.replica &&
      at.replica.unconfirmed().length === 0 &&
      at.link?.textState(name) === "current"
    );
  });
  return { root, take, put };
}

describe("moving a workspace between two servers", () => {
  it("lands whole on the target and leaves the room it left empty", async () => {
    const { a, b, live, move } = await servers;
    const { root, take, put } = await syncedOnA("band");

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

describe("copying a workspace between two servers", () => {
  it("lands whole on the target and stays synced where it was", async () => {
    const { a, b, live, move } = await servers;
    const { root, take, put } = await syncedOnA("duo");

    await move.startCopy(root, b.origin);
    await until(() => move.moveState(root) === undefined, 60_000);

    // B holds it whole, the take's bytes included…
    expect([...b.files("duo").keys()].sort()).toEqual([
      "song.k7/clips/take.wav",
      "song.k7/project.yaml",
    ]);
    const ref = parseBlobRef(
      b.files("duo").get("song.k7/clips/take.wav") ?? "",
    );
    expect(ref?.size).toBe(take.length);
    // …and A still does: nothing was taken off it.
    expect(a.files("duo").size).toBe(2);

    // It still syncs with A, and B's copy is listed as a workspace of B's.
    expect(live.attachedAt(root)?.server?.url).toBe(a.url);
    const status = await live.workspaceSyncStatus(["duo"]);
    expect(status.workspaces).toContainEqual({
      name: "duo",
      state: "synced",
      server: a.origin,
    });
    expect(status.workspaces).toContainEqual({
      name: "duo",
      state: "server",
      server: b.origin,
    });

    // An edit made after the copy reaches A, and not B's copy.
    put("song.k7/notes.yaml", "notes: after the copy\n");
    await until(() => a.files("duo").has("song.k7/notes.yaml"));
    await new Promise((r) => setTimeout(r, 500));
    expect(b.files("duo").has("song.k7/notes.yaml")).toBe(false);

    // A second copy is refused by the name the target now holds.
    await expect(move.startCopy(root, b.origin)).rejects.toThrow(
      /already has a workspace called 'duo'/,
    );
  }, 120_000);
});
