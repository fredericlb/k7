import { mkdtempSync, rmSync } from "node:fs";
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
let failRecords: boolean;

// A PocketBase with one session, and fields of its own the store does not keep.
const COLLECTIONS: Record<string, Record<string, unknown>[]> = {
  Sessions: [
    {
      id: "pbsession0000001",
      collectionId: "x",
      created: "2024",
      Uid: "u1",
      RecordingMime: "audio/webm",
      Duration: 12,
    },
  ],
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "k7-import-"));
  failRecords = false;
  const app = express();
  app.use(express.json());
  app.post("/api/collections/_superusers/auth-with-password", (req, res) =>
    req.body.password === "pw"
      ? res.json({ token: "t" })
      : res.status(400).end(),
  );
  app.get("/api/collections/:c/records", (req, res) =>
    failRecords
      ? res.status(500).end()
      : res.json({ items: COLLECTIONS[req.params.c] ?? [], totalPages: 1 }),
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
  it("copies rows with their ids, and only the fields schema.ts names", async () => {
    const store = openStore();
    const counts = await importFromPocketbase(
      { url, email: "a", password: "pw" },
      store,
    );
    expect(counts).toMatchObject({ Sessions: 1 });
    const [session] = await store.listRecords("Sessions");
    expect(session.id).toBe("pbsession0000001");
    expect(session.fields).toMatchObject({
      Uid: "u1",
      RecordingMime: "audio/webm",
    });
    expect(session.fields).not.toHaveProperty("collectionId");
    expect(session.fields).not.toHaveProperty("created");
  });

  it("imports into a store that already holds rows of its own", async () => {
    const store = openStore();
    store.addRecords("Comments", [{ OwnerId: "me" }]);
    const counts = await importFromPocketbase(
      { url, email: "a", password: "pw" },
      store,
    );
    expect(counts).toMatchObject({ Sessions: 1 });
    expect(store.getRecord("Sessions", "pbsession0000001")).not.toBeNull();
    expect(store.listRecords("Comments")).toHaveLength(1);
  });

  it("does nothing once one of its rows is in the store", async () => {
    const store = openStore();
    const src = { url, email: "a", password: "pw" };
    await importFromPocketbase(src, store);
    expect(await importFromPocketbase(src, store)).toBeNull();
    expect(store.listRecords("Sessions")).toHaveLength(1);
  });

  it("leaves the store empty when PocketBase fails halfway, so the next start retries", async () => {
    failRecords = true;
    const store = openStore();
    await expect(
      importFromPocketbase({ url, email: "a", password: "pw" }, store),
    ).rejects.toThrow();
    expect(store.isEmpty()).toBe(true);
  });
});
