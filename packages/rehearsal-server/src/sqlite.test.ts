import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlite, INDEXED_FIELDS } from "./sqlite.ts";

let dir: string;
let db: ReturnType<typeof createSqlite>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "k7-sqlite-"));
  db = createSqlite(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the SQLite store", () => {
  it("reads a field a row never set as its type's zero value", async () => {
    await db.addRecords("Songs", [{ Uid: "u1", OwnerId: "me" }]);
    const [rec] = await db.listRecords("Songs");
    expect(rec.id).toMatch(/^[a-z0-9]{15}$/);
    expect(rec.fields).toMatchObject({
      Uid: "u1",
      Lyrics: "",
      FetchProgress: 0,
      Private: false,
    });
  });

  it("filters as an IN per key, booleans included, and projects", async () => {
    await db.addRecords("Songs", [
      { Uid: "a", Private: true, Title: "A" },
      { Uid: "b", Private: false, Title: "B" },
      { Uid: "c", Title: "C" },
    ]);
    const uids = async (f: Record<string, unknown>) =>
      (await db.listRecords("Songs", f)).map((r) => r.fields.Uid);
    expect(await uids({ Uid: ["a", "c"] })).toEqual(["a", "c"]);
    expect(await uids({ Private: [true] })).toEqual(["a"]);
    expect(await uids({ Uid: [] })).toEqual([]);
    const [p] = await db.listRecords(
      "Songs",
      { Uid: "b" },
      { fields: ["Title"] },
    );
    expect(p.fields).toEqual({ Title: "B" });
  });

  it("patches by merging, and refuses a row that is not there", async () => {
    const [{ id }] = await db.addRecords("Songs", [{ Uid: "a", Title: "x" }]);
    await db.patchRecord("Songs", id, { Lyrics: "la" });
    const [rec] = await db.listRecords("Songs");
    expect(rec.fields).toMatchObject({ Title: "x", Lyrics: "la" });
    expect(() => db.patchRecord("Songs", "nope", {})).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it("keeps a sheet's bytes as a file, and a deleted song takes its sheets", async () => {
    const [{ id }] = await db.addRecords("Songs", [{ Uid: "a" }]);
    const sheet = await db.uploadAttachment(
      Buffer.from("pdf"),
      "application/pdf",
      "a.pdf",
      id,
    );
    const file = db.attachmentFile(sheet);
    expect(file).toBe(join(dir, "sheets", sheet));
    expect(readFileSync(file as string, "utf8")).toBe("pdf");
    await db.deleteRecords("Songs", [id]);
    expect(db.attachmentFile(sheet)).toBeNull();
    expect(existsSync(file as string)).toBe(false);
  });

  it("keeps an id it is given, and writes all of a transaction or none", async () => {
    await db.addRecords("Songs", [{ id: "kept", Uid: "a" }]);
    expect((await db.listRecords("Songs"))[0].id).toBe("kept");
    expect(() =>
      db.inTransaction(() => {
        db.addRecords("Songs", [{ Uid: "b" }]);
        db.deleteRecords("Songs", ["kept"]);
        throw new Error("halfway");
      }),
    ).toThrow("halfway");
    expect(db.listRecords("Songs").map((r) => r.id)).toEqual(["kept"]);
  });

  it("refuses an async function as a transaction, and rolls back what it wrote", async () => {
    expect(() =>
      db.inTransaction(async () => {
        db.addRecords("Songs", [{ Uid: "b" }]);
      }),
    ).toThrow(/synchronous/);
    expect(db.listRecords("Songs")).toEqual([]);
    // The connection is out of the failed transaction: the next write lands.
    db.addRecords("Songs", [{ Uid: "c" }]);
    expect(db.listRecords("Songs")).toHaveLength(1);
  });

  it("projects in SQL: zero values for missing fields, booleans back, filled texts as flags", () => {
    db.addRecords("Songs", [
      { Uid: "a", Private: true, Lyrics: "la", Tablature: " \n " },
      { Uid: "b" },
    ]);
    const rows = db.listRecords("Songs", undefined, {
      fields: ["Uid", "Private", "FetchProgress", "Title"],
      filled: ["Lyrics", "Tablature"],
    });
    expect(rows.map((r) => r.fields)).toEqual([
      {
        Uid: "a",
        Private: true,
        FetchProgress: 0,
        Title: "",
        Lyrics: true,
        Tablature: false,
      },
      {
        Uid: "b",
        Private: false,
        FetchProgress: 0,
        Title: "",
        Lyrics: false,
        Tablature: false,
      },
    ]);
    expect(db.listRecords("Songs", undefined, { fields: [] })).toHaveLength(2);
  });

  it("reads one row by its primary key", () => {
    const [{ id }] = db.addRecords("Comments", [{ OwnerId: "o", Text: "t" }]);
    expect(db.getRecord("Comments", id)?.fields).toMatchObject({
      OwnerId: "o",
      Text: "t",
      SessionUid: "",
    });
    expect(db.getRecord("Comments", "missing")).toBeNull();
    expect(db.getRecord("Markers", id)).toBeNull();
  });

  it("looks a row up by an indexed field through its index, not a scan", async () => {
    await db.addRecords("Comments", [{ SessionUid: "s", OwnerId: "o" }]);
    for (const f of INDEXED_FIELDS) {
      const plan = db.planOf("Comments", { [f]: ["x", "y"] }).join("\n");
      expect(plan).toContain(`USING INDEX records_by_${f}`);
    }
    const two = db.planOf("Markers", { SessionUid: ["s"], MomentId: ["m"] });
    expect(two.join("\n")).toMatch(/USING INDEX records_by_/);
  });

  it("drops a retired collection's rows when an older file opens", () => {
    db.addRecords("Highlights", [{ SessionUid: "s" }]);
    db.addRecords("Markers", [{ SessionUid: "s" }]);
    const reopened = createSqlite(dir);
    expect(reopened.listRecords("Highlights")).toEqual([]);
    expect(reopened.listRecords("Markers")).toHaveLength(1);
    reopened.close();
  });
});
