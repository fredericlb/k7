// What a client sends is never what the server serves back: an upload's type is checked, a stream's
// type is the server's, and a published version's folder is its own — ../docs/serving.md.

import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { songFolder } from "@studio/mediatek/song";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The library answered in this process; the rest goes to the stub médiathèque below.
vi.mock("./mediatek.ts", async (actual) => ({
  ...(await actual<typeof import("./mediatek.ts")>()),
  download: async (path: string, dest: string) => {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(process.env.STUDIO_MEDIATEK as string, path), dest);
  },
}));

// The store and the library are opened at import, so the environment is set before anything loads.
const dir = mkdtempSync(join(tmpdir(), "k7-serving-"));
process.env.K7_DATA_DIR = join(dir, "data");
process.env.STUDIO_MEDIATEK = join(dir, "library");
const db = await import("./db.ts");
(await import("@studio/mediatek/layout")).ensureLayout();
const store = await import("./store.ts");
const { linkMediatek } = await import("./mediatek.ts");
const { releasesRouter } = await import("./routes/releases.ts");
const { sessionsRouter } = await import("./routes/sessions.ts");
const { jsonErrors } = await import("./errors.ts");

const servers: Server[] = [];
const listen = (app: express.Express): Promise<string> =>
  new Promise((ok) => {
    const s = app.listen(0, () =>
      ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    );
    servers.push(s);
  });

// A médiathèque that files what it is given and remembers what was removed.
const songs: { folder: string; title: string }[] = [];
const removedTrees: string[] = [];
const removedFiles: string[] = [];
let local: string;

beforeAll(async () => {
  const lib = express();
  lib.post("/api/mediatek/song", express.raw({ type: "*/*" }), (req, res) => {
    const q = req.query as Record<string, string>;
    const folder = songFolder({
      artist: q.artist,
      album: q.album,
      title: q.title,
    });
    songs.push({ folder, title: q.title });
    const ext = q.filename.split(".").pop();
    res.json({ path: folder, master: `${folder}/mixdown.${ext}` });
  });
  lib.delete("/api/mediatek/folder", (req, res) => {
    removedTrees.push(String(req.query.path));
    res.json({ ok: true });
  });
  lib.delete("/api/mediatek/file", (req, res) => {
    removedFiles.push(String(req.query.path));
    res.json({ ok: true });
  });
  lib.get("/api/mediatek/stream", (_req, res) =>
    res.send("<script>x</script>"),
  );
  linkMediatek({ base: await listen(lib) });

  const app = express();
  app.use(express.json());
  // `x-as` names the signed-in user.
  app.use((req, _res, next) => {
    (req as { user?: { sub: string } }).user = {
      sub: req.get("x-as") ?? "alice",
    };
    next();
  });
  app.use("/releases", releasesRouter);
  app.use("/sessions", sessionsRouter);
  app.use(jsonErrors);
  local = await listen(app);
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  db.store.close();
  rmSync(dir, { recursive: true, force: true });
});

const upload = (
  path: string,
  field: string,
  type: string,
  name: string,
  as = "alice",
  extra: Record<string, string> = {},
  method = "POST",
) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append(field, new Blob(["bytes"], { type }), name);
  return fetch(`${local}${path}`, {
    method,
    headers: { "x-as": as },
    body: form,
  });
};

type Release = { id: string; versions: { id: string }[] };

const newRelease = async (as: string, title = "Same Song") => {
  const res = await upload("/releases", "audio", "audio/mpeg", "a.mp3", as, {
    title,
    artist: "Band",
    versionName: "Version",
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Release;
};

describe("an uploaded file that says it is not audio", () => {
  it("is refused by every release route", async () => {
    const html = (path: string, extra = {}, method = "POST") =>
      upload(path, "audio", "text/html", "x.html", "alice", extra, method);
    expect((await html("/releases", { title: "T", artist: "A" })).status).toBe(
      400,
    );
    const release = await newRelease("alice", "Refusals");
    const v = release.versions[0].id;
    expect((await html(`/releases/${release.id}/versions`)).status).toBe(400);
    expect(
      (await html(`/releases/${release.id}/versions/${v}/audio`, {}, "PUT"))
        .status,
    ).toBe(400);
  });

  it("is refused as a session's recording", async () => {
    const session = await store.createSession("alice");
    const res = await upload(
      `/sessions/${session.id}/recording`,
      "audio",
      "text/html",
      "x.html",
      "alice",
      { envelope: JSON.stringify({ intervalMs: 10, samples: [0] }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("a published version", () => {
  it("is served as audio, whatever type its row stored", async () => {
    const release = await newRelease("alice", "Served");
    const v = release.versions[0].id;
    const [row] = await db.listRecords("Versions", { Uid: [v] });
    await db.patchRecord("Versions", row.id, { AudioMime: "text/html" });
    const res = await fetch(
      `${local}/releases/${release.id}/versions/${v}/audio`,
    );
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("lands in a folder carrying its release's and its own uid", async () => {
    const release = await newRelease("alice", "Tagged");
    const v = release.versions[0].id;
    const { folder } = songs.at(-1) as { folder: string };
    expect(folder).toContain(`Tagged (${release.id.slice(0, 8)})`);
    expect(folder).toContain(`Version (${v.slice(0, 8)})`);
  });

  it("deleted, removes its own folder and leaves another user's same-named version", async () => {
    const a = await newRelease("alice");
    const aFolder = (songs.at(-1) as { folder: string }).folder;
    const b = await newRelease("bob");
    const bFolder = (songs.at(-1) as { folder: string }).folder;
    expect(bFolder).not.toBe(aFolder);
    const v = b.versions[0].id;
    const res = await fetch(`${local}/releases/${b.id}/versions/${v}`, {
      method: "DELETE",
      headers: { "x-as": "bob" },
    });
    expect(res.status).toBe(204);
    expect(removedTrees).toContain(bFolder);
    expect(removedTrees).not.toContain(aFolder);
    expect(a.versions[0].id).not.toBe(v);
  });

  it("in a legacy folder, removes only files no other version names", async () => {
    const legacy = "songs/K7/Old/Version";
    await db.addRecords("Versions", [
      { Uid: "keep", ReleaseUid: "r-old", AudioPath: `${legacy}/m.mp3` },
      { Uid: "drop", ReleaseUid: "r-old", AudioPath: `${legacy}/m.mp3` },
    ]);
    await store.deleteVersion("r-old", "drop");
    expect(removedTrees).not.toContain(legacy);
    expect(removedFiles).not.toContain(`${legacy}/m.mp3`);
  });
});
