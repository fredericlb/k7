import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reset } from "@studio/mediatek/catalogue";
import { ensureLayout } from "@studio/mediatek/layout";
import type { ManifestEntry } from "@studio/mediatek/manifest";
import { readSynced } from "@studio/mediatek/synced";
import { removeLibrary } from "@studio/mediatek/testLibrary";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadEntries } from "./download.ts";
import { keepListing, lastListing } from "./listings.ts";
import { reachOf } from "./reach.ts";
import { DEVICE_LIBRARY_ROUTE, type PairedServer } from "./server.ts";
import { checkSongUpdates, songSyncJobs } from "./updates.ts";

// The local volume is this process's; the "server" is a stub whose songs a test edits between calls.
const SONG = "songs/A/B/S";
let root: string;
let servers: Server[] = [];
let files: Record<string, { body: string; mtime: number }>;
let rev: string;
let asked: string[];
let server: PairedServer;

const manifestOf = (): ManifestEntry[] =>
  Object.entries(files).map(([path, f]) => ({
    path,
    bytes: f.body.length,
    mtime: f.mtime,
  }));

async function stub(): Promise<PairedServer> {
  const app = express();
  app.use(DEVICE_LIBRARY_ROUTE, (req, res, next) => {
    asked.push(req.path);
    return req.headers.authorization === "Bearer t"
      ? next()
      : res.status(401).end();
  });
  app.get(`${DEVICE_LIBRARY_ROUTE}/revision`, (_req, res) =>
    res.json({ present: true, revisions: { songs: rev } }),
  );
  app.get(`${DEVICE_LIBRARY_ROUTE}/manifest`, (_req, res) =>
    res.json({ family: "songs", rev, files: manifestOf() }),
  );
  app.get(`${DEVICE_LIBRARY_ROUTE}/file`, (req, res) => {
    const f = files[String(req.query.path)];
    if (!f) return res.status(404).end();
    res.send(f.body);
  });
  const base = await new Promise<string>((ok) => {
    const s = app.listen(0, () =>
      ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    );
    servers.push(s);
  });
  return { base, token: "t" };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "server-songs-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  reset();
  files = {
    [`${SONG}/song.yaml`]: { body: "title: S\nsource: upload\n", mtime: 1 },
    [`${SONG}/lyrics.txt`]: { body: "la la", mtime: 1 },
  };
  rev = "1";
  asked = [];
  server = await stub();
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  servers = [];
  delete process.env.STUDIO_MEDIATEK;
  reset();
  await removeLibrary(root);
});

const local = (rel: string) => join(root, rel);
const fileCalls = () => asked.filter((p) => p === "/file").length;

describe("a song that follows its server", () => {
  it("keeps the server's rows beside it, and copies only what changed next time", async () => {
    await downloadEntries(server, "songs", [SONG], { follow: true });
    expect(readSynced(local(SONG))).toMatchObject({
      server: server.base,
      rev: "1",
    });
    expect(fileCalls()).toBe(2);
    files[`${SONG}/lyrics.txt`] = { body: "la la la", mtime: 2 };
    files[`${SONG}/chords.txt`] = { body: "C G", mtime: 2 };
    delete files[`${SONG}/song.yaml`];
    asked = [];
    await downloadEntries(server, "songs", [SONG]);
    expect(fileCalls()).toBe(2);
    expect(readFileSync(local(`${SONG}/lyrics.txt`), "utf8")).toBe("la la la");
    expect(existsSync(local(`${SONG}/song.yaml`))).toBe(false);
  });

  it("writes no sidecar for a download that does not follow", async () => {
    await downloadEntries(server, "songs", [SONG]);
    expect(readSynced(local(SONG))).toBeNull();
  });
});

describe("the update check", () => {
  beforeEach(async () => {
    await downloadEntries(server, "songs", [SONG], { follow: true });
    asked = [];
  });

  it("stops at the revision when nothing moved on the server", async () => {
    await checkSongUpdates(() => [server]);
    expect(asked).toEqual(["/revision"]);
    expect(songSyncJobs().slice(-1)).toEqual([
      expect.objectContaining({ kind: "check", phase: "done", updated: 0 }),
    ]);
  });

  it("brings a changed song down again, listed as its own job", async () => {
    rev = "2";
    files[`${SONG}/lyrics.txt`] = { body: "new", mtime: 3 };
    await checkSongUpdates(() => [server]);
    expect(readFileSync(local(`${SONG}/lyrics.txt`), "utf8")).toBe("new");
    expect(readSynced(local(SONG))?.rev).toBe("2");
    const jobs = songSyncJobs();
    expect(jobs.findLast((j) => j.kind === "song")).toMatchObject({
      path: SONG,
      phase: "done",
    });
    expect(jobs.findLast((j) => j.kind === "check")).toMatchObject({
      updated: 1,
    });
  });

  it("keeps a song the server removed, which stops following it", async () => {
    rev = "2";
    files = {};
    await checkSongUpdates(() => [server]);
    expect(existsSync(local(`${SONG}/lyrics.txt`))).toBe(true);
    expect(readSynced(local(SONG))).toBeNull();
    expect(songSyncJobs().findLast((j) => j.kind === "check")).toMatchObject({
      gone: 1,
    });
  });

  it("lists nothing at all when no song follows a server", async () => {
    rmSidecar();
    const before = songSyncJobs().length;
    await checkSongUpdates(() => [server]);
    expect(songSyncJobs().length).toBe(before);
  });
});

function rmSidecar() {
  writeFileSync(local(`${SONG}/.synced.json`), "not json");
}

describe("the server's reach", () => {
  it("says a server that answers is reachable, and one gone is not", async () => {
    expect((await reachOf(server)).reachable).toBe(true);
    const gone = { base: "http://127.0.0.1:9", token: "t" };
    expect((await reachOf(gone)).reachable).toBe(false);
  });
});

describe("the last listing", () => {
  it("is read back from disk once memory is another root's", () => {
    const listing = {
      family: "songs" as const,
      rev: "9",
      entries: [],
      unlisted: [],
    };
    keepListing("srv songs", listing);
    const other = mkdtempSync(join(tmpdir(), "server-songs-other-"));
    mkdirSync(other, { recursive: true });
    process.env.STUDIO_MEDIATEK = other;
    expect(lastListing("srv songs")).toBeUndefined();
    process.env.STUDIO_MEDIATEK = root;
    expect(lastListing("srv songs")).toEqual(listing);
  });
});
