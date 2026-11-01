// uploads.test.ts — this machine's songs sent up to a stub server through its device door: a song the server lacks goes
// and then follows it, one already there or removed there stays, one half sent is finished. ../../../docs/media/songUploads.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reset } from "@studio/mediatek/catalogue";
import { ensureLayout } from "@studio/mediatek/layout";
import { markLeft, markUploading, readSynced } from "@studio/mediatek/synced";
import { removeLibrary } from "@studio/mediatek/testLibrary";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_HEADER, DOOR_PATH } from "../../remote/door.ts";
import { songSyncJobs } from "./jobs.ts";
import { DEVICE_LIBRARY_ROUTE, type PairedServer } from "./server.ts";
import { uploadSongs } from "./uploads.ts";

const SONG = "songs/A/B/S";
let root: string;
let servers: Server[] = [];
let theirs: Record<string, string>;
let put: string[];
let server: PairedServer;

async function stub(): Promise<PairedServer> {
  const app = express();
  app.get(`${DEVICE_LIBRARY_ROUTE}/manifest`, (_req, res) =>
    res.json({
      family: "songs",
      rev: String(Object.keys(theirs).length),
      files: Object.entries(theirs).map(([path, body]) => ({
        path,
        bytes: body.length,
        mtime: 7,
      })),
    }),
  );
  app.put(
    `${DOOR_PATH}/api/mediatek/file`,
    express.raw({ type: "*/*" }),
    (req, res) => {
      if (req.get(DEVICE_HEADER) !== "t") return void res.status(401).end();
      const path = String(req.query.path);
      put.push(path);
      theirs[path] = (req.body as Buffer).toString();
      res.json({ ok: true });
    },
  );
  const base = await new Promise<string>((ok) => {
    const s = app.listen(0, () =>
      ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    );
    servers.push(s);
  });
  return { base, token: "t" };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "song-uploads-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  reset();
  mkdirSync(join(root, SONG), { recursive: true });
  writeFileSync(join(root, SONG, "song.yaml"), "title: S\nsource: upload\n");
  writeFileSync(join(root, SONG, "lyrics.txt"), "la la");
  theirs = {};
  put = [];
  server = await stub();
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  servers = [];
  delete process.env.STUDIO_MEDIATEK;
  reset();
  await removeLibrary(root);
});

describe("this machine's songs go up", () => {
  it("sends a song the server lacks, then the song follows the server", async () => {
    await uploadSongs(() => [server]);
    expect(put.sort()).toEqual([`${SONG}/lyrics.txt`, `${SONG}/song.yaml`]);
    expect(readSynced(join(root, SONG))?.server).toBe(server.base);
    expect(songSyncJobs().findLast((j) => j.kind === "upload")).toMatchObject({
      path: SONG,
      phase: "done",
    });
    put = [];
    await uploadSongs(() => [server]);
    expect(put).toEqual([]);
  });

  it("leaves a song the server already holds, and one the server removed", async () => {
    theirs[`${SONG}/song.yaml`] = "theirs";
    await uploadSongs(() => [server]);
    expect(put).toEqual([]);
    expect(readSynced(join(root, SONG))).toBeNull();
    theirs = {};
    markLeft(join(root, SONG), server.base);
    await uploadSongs(() => [server]);
    expect(put).toEqual([]);
  });

  it("finishes a song half sent, sending only what did not land", async () => {
    theirs[`${SONG}/song.yaml`] = "title: S\nsource: upload\n";
    markUploading(join(root, SONG), server.base);
    await uploadSongs(() => [server]);
    expect(put).toEqual([`${SONG}/lyrics.txt`]);
    expect(readSynced(join(root, SONG))?.files).toHaveLength(2);
  });

  it("waits while the server is away", async () => {
    const away = { base: "http://127.0.0.1:9", token: "t" };
    await uploadSongs(() => [away]);
    expect(readSynced(join(root, SONG))).toBeNull();
  });
});
