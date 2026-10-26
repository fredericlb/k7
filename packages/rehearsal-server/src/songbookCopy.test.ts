import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SongbookPlacement } from "@studio/rehearsal-shared";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inProcessSongbook } from "./inProcessSongbook.ts";

// The library answered in this process, over a temporary volume — see inProcessSongbook.ts.
vi.mock("./mediatek.ts", async (actual) => ({
  ...(await actual<typeof import("./mediatek.ts")>()),
  songbook: () => inProcessSongbook(),
}));

// The store and the library are chosen at import, so the environment is set before anything loads.
const dir = mkdtempSync(join(tmpdir(), "k7-copy-"));
process.env.K7_DATA_DIR = join(dir, "data");
process.env.STUDIO_MEDIATEK = join(dir, "library");
const db = await import("./db.ts");
const book = await import("@studio/mediatek/songbook");
const { ensureLayout } = await import("@studio/mediatek/layout");
const { songbookCopyRouter, songbookDeviceRouter } = await import(
  "./songbookCopy.ts"
);
const { songsRouter } = await import("./routes/songs.ts");

const servers: Server[] = [];
const listen = (app: express.Express): Promise<string> =>
  new Promise((ok) => {
    const s = app.listen(0, () =>
      ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    );
    servers.push(s);
  });

const asMe: express.RequestHandler = (req, _res, next) => {
  (req as { user?: { sub: string } }).user = { sub: "me" };
  next();
};

let stub: string;
let local: string;
const fetched: string[] = [];

/** A songbook song filed in this machine's library, as a download or a person would leave it. */
async function songHere(id: string, title: string) {
  book.createSongbook({ id, artist: "A", title, owner: "me" });
  await book.patchSongbook(id, { lyrics: `${title} lyrics` });
}

beforeAll(async () => {
  ensureLayout();
  // The server's songbook: one song this machine lacks, one it already holds.
  const s = express();
  s.get("/dev", (_req, res) =>
    res.json([
      { id: "pub", artist: "A", title: "Public", path: "songs/A/x/Public" },
      { id: "here", artist: "A", title: "Already here", path: "songs/A/x/H" },
    ]),
  );
  stub = await listen(s);

  await songHere("here", "Already here");
  const app = express();
  app.use(express.json());
  app.use(asMe);
  app.use(
    "/dev",
    songbookDeviceRouter((_req, _res, next) => next()),
  );
  app.use("/songs", songsRouter);
  app.use(
    "/copy",
    songbookCopyRouter({
      deviceRoute: "/dev",
      server: () => ({ base: stub, token: "t" }),
      // The folder comes down: here, the song is filed as the server had it.
      fetchFolder: async (_req, folder) => {
        fetched.push(folder);
        await songHere("pub", "Public");
      },
    }),
  );
  local = await listen(app);
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  db.store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the device's door", () => {
  it("lists every songbook song with the folder a copy downloads", async () => {
    const songs = (await (await fetch(`${local}/dev`)).json()) as {
      id: string;
      path: string;
    }[];
    expect(songs).toEqual([
      expect.objectContaining({
        id: "here",
        path: "songs/A/Album inconnu/Already here",
      }),
    ]);
  });
});

describe("copying a server's song", () => {
  it("places by id, then brings the song's folder down and marks where it came from", async () => {
    const before = (await (
      await fetch(`${local}/copy`)
    ).json()) as SongbookPlacement;
    expect(before.synced).toEqual(["here"]);
    expect(before.serverOnly.map((s) => s.id)).toEqual(["pub"]);

    const r = await fetch(`${local}/copy/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "pub" }),
    });
    expect(r.status).toBe(200);
    expect(fetched).toEqual(["songs/A/x/Public"]);
    expect((await book.readSongbook("pub"))?.facts.origin).toBe(stub);

    const after = (await (
      await fetch(`${local}/copy`)
    ).json()) as SongbookPlacement;
    expect(after.serverOnly).toEqual([]);
  });
});

describe("a copy on this machine", () => {
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${local}/songs/pub${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("reads, takes a star, and refuses every edit", async () => {
    const song = await (await call("GET", "")).json();
    expect(song).toMatchObject({
      origin: stub,
      canDelete: true,
      lyrics: "Public lyrics",
    });
    expect((await call("PATCH", "", { lyrics: "new" })).status).toBe(403);
    expect((await call("DELETE", "/audio")).status).toBe(403);
    expect((await call("PUT", "/favorite", { favorite: true })).status).toBe(
      200,
    );
  });

  it("is removed from this machine only, its stars with it, and is offered again", async () => {
    expect((await call("DELETE", "")).status).toBe(204);
    expect(await book.readSongbook("pub")).toBeNull();
    expect(await db.listRecords("SongFavorites", { SongUid: ["pub"] })).toEqual(
      [],
    );
    const placement = (await (
      await fetch(`${local}/copy`)
    ).json()) as SongbookPlacement;
    expect(placement.serverOnly.map((s) => s.id)).toEqual(["pub"]);
  });
});
