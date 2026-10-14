import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SongbookPlacement } from "@studio/rehearsal-shared";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The store is chosen at import, so the environment is set before anything of it loads.
const dir = mkdtempSync(join(tmpdir(), "k7-copy-"));
process.env.K7_DATA_DIR = dir;
const db = await import("./db.ts");
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
const tracks: string[] = [];

beforeAll(async () => {
  // The server: one public song with a sheet and a track, one private song.
  const s = express();
  s.get("/dev", (_req, res) =>
    res.json([
      { id: "pub", artist: "A", title: "Public" },
      { id: "here", artist: "B", title: "Already here" },
    ]),
  );
  s.get("/dev/pub", (_req, res) =>
    res.json({
      fields: { Artist: "A", Title: "Public", AudioPath: "songs/A/x/t.flac" },
      sheets: [{ id: "s1", name: "a.pdf", mime: "application/pdf" }],
    }),
  );
  s.get("/dev/pub/sheets/s1", (_req, res) => res.send("pdf bytes"));
  stub = await listen(s);

  await db.addRecords("Songs", [
    { Uid: "here", OwnerId: "me", Title: "Already here" },
    { Uid: "secret", OwnerId: "x", Title: "Mine", Private: true },
  ]);
  const app = express();
  app.use(express.json());
  app.use(asMe);
  // The gate as deviceGate leaves it: the person a device's token names, here from a header.
  app.use(
    "/dev",
    songbookDeviceRouter((req, res, next) => {
      res.locals.syncCaller = {
        slug: "a",
        person: req.headers["x-person"] ?? null,
      };
      next();
    }),
  );
  app.use("/songs", songsRouter);
  app.use(
    "/copy",
    songbookCopyRouter({
      deviceRoute: "/dev",
      server: () => ({ base: stub, token: "t" }),
      fetchTrack: async (_req, path) => void tracks.push(path),
    }),
  );
  local = await listen(app);
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  rmSync(dir, { recursive: true, force: true });
});

describe("the device's door", () => {
  const ids = async (person?: string) =>
    (
      (await (
        await fetch(`${local}/dev`, {
          headers: person ? { "x-person": person } : {},
        })
      ).json()) as { id: string }[]
    ).map((s) => s.id);

  it("offers a private song to the person who owns it, and to nobody else", async () => {
    expect(await ids()).toEqual(["here"]);
    expect(await ids("someone")).toEqual(["here"]);
    expect(await ids("x")).toEqual(["here", "secret"]);
    expect((await fetch(`${local}/dev/secret`)).status).toBe(404);
    expect(
      (await fetch(`${local}/dev/secret`, { headers: { "x-person": "x" } }))
        .status,
    ).toBe(200);
  });
});

describe("copying a server's song", () => {
  it("places by id, then copies the song with its sheet and its track", async () => {
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
    expect(tracks).toEqual(["songs/A/x/t.flac"]);

    const [rec] = await db.listRecords("Songs", { Uid: ["pub"] });
    expect(rec.fields).toMatchObject({
      Title: "Public",
      OwnerId: "me",
      Origin: stub,
    });
    const [sheet] = JSON.parse(String(rec.fields.SheetMeta));
    expect(sheet.id).toBe("s1");
    expect(
      readFileSync(db.attachmentFile(sheet.attachmentId) as string, "utf8"),
    ).toBe("pdf bytes");

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
    expect(song).toMatchObject({ origin: stub, canDelete: true });
    expect((await call("PATCH", "", { lyrics: "new" })).status).toBe(403);
    expect((await call("DELETE", "/audio")).status).toBe(403);
    expect((await call("PUT", "/favorite", { favorite: true })).status).toBe(
      200,
    );
  });

  it("is removed from this machine only, and is offered again", async () => {
    expect((await call("DELETE", "")).status).toBe(204);
    expect(await db.listRecords("Songs", { Uid: ["pub"] })).toEqual([]);
    const placement = (await (
      await fetch(`${local}/copy`)
    ).json()) as SongbookPlacement;
    expect(placement.serverOnly.map((s) => s.id)).toEqual(["pub"]);
  });
});
