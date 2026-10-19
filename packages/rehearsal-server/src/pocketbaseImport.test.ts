import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importFromPocketbase } from "./pocketbaseImport.ts";
import { createSqlite } from "./sqlite.ts";

let dir: string;
let server: Server;
let url: string;
let failSheets: boolean;

// A PocketBase with one song, its sheet, and a field of its own the store does not keep.
const COLLECTIONS: Record<string, Record<string, unknown>[]> = {
  Songs: [
    {
      id: "pbsong00000001",
      collectionId: "x",
      created: "2024",
      Uid: "u1",
      Title: "Song",
      Private: true,
      SheetMeta: JSON.stringify([
        { id: "sh1", attachmentId: "pbsheet0000001", name: "a.pdf" },
      ]),
    },
  ],
  song_sheets: [
    {
      id: "pbsheet0000001",
      song: "pbsong00000001",
      name: "a.pdf",
      mime: "application/pdf",
      file: "a_x1.pdf",
    },
  ],
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "k7-import-"));
  failSheets = false;
  const app = express();
  app.use(express.json());
  app.post("/api/collections/_superusers/auth-with-password", (req, res) =>
    req.body.password === "pw"
      ? res.json({ token: "t" })
      : res.status(400).end(),
  );
  app.get("/api/collections/:c/records", (req, res) =>
    res.json({ items: COLLECTIONS[req.params.c] ?? [], totalPages: 1 }),
  );
  app.get("/api/files/song_sheets/:id/:name", (_req, res) =>
    failSheets ? res.status(500).end() : res.send("pdf bytes"),
  );
  url = await new Promise((ok) => {
    server = app.listen(0, () =>
      ok(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    );
  });
});

// Every store a test opens, closed before its folder goes: Windows will not remove an open file.
const opened: ReturnType<typeof createSqlite>[] = [];
const openStore = () => {
  const s = createSqlite(dir);
  opened.push(s);
  return s;
};

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  for (const s of opened.splice(0)) s.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the import from PocketBase", () => {
  it("copies rows and sheets with their ids, and only the fields schema.ts names", async () => {
    const store = openStore();
    const counts = await importFromPocketbase(
      { url, email: "a", password: "pw" },
      store,
    );
    expect(counts).toMatchObject({ Songs: 1, song_sheets: 1, Sessions: 0 });
    const [song] = await store.listRecords("Songs");
    expect(song.id).toBe("pbsong00000001");
    expect(song.fields).toMatchObject({ Uid: "u1", Private: true });
    expect(song.fields).not.toHaveProperty("collectionId");
    const file = store.attachmentFile("pbsheet0000001");
    expect(readFileSync(file as string, "utf8")).toBe("pdf bytes");
    // The sheet belongs to the song by its kept id, so removing the song removes it.
    await store.deleteRecords("Songs", [song.id]);
    expect(store.attachmentFile("pbsheet0000001")).toBeNull();
  });

  it("imports into a store that already holds rows of its own", async () => {
    const store = openStore();
    store.addRecords("Sessions", [{ Uid: "s1" }]);
    const counts = await importFromPocketbase(
      { url, email: "a", password: "pw" },
      store,
    );
    expect(counts).toMatchObject({ Songs: 1 });
    expect(store.getRecord("Songs", "pbsong00000001")).not.toBeNull();
    expect(store.listRecords("Sessions")).toHaveLength(1);
  });

  it("does nothing once one of its rows is in the store", async () => {
    const store = openStore();
    const src = { url, email: "a", password: "pw" };
    await importFromPocketbase(src, store);
    expect(await importFromPocketbase(src, store)).toBeNull();
    expect(store.listRecords("Songs")).toHaveLength(1);
  });

  it("leaves the store empty when PocketBase fails halfway, so the next start retries", async () => {
    failSheets = true;
    const store = openStore();
    await expect(
      importFromPocketbase({ url, email: "a", password: "pw" }, store),
    ).rejects.toThrow();
    expect(store.isEmpty()).toBe(true);
  });
});
