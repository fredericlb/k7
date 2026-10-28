import { mkdtempSync, rmSync } from "node:fs";
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
    await db.addRecords("Sessions", [{ Uid: "u1", OwnerId: "me" }]);
    const [rec] = await db.listRecords("Sessions");
    expect(rec.id).toMatch(/^[a-z0-9]{15}$/);
    expect(rec.fields).toMatchObject({
      Uid: "u1",
      RecordingMime: "",
      Duration: 0,
      HasRecording: false,
    });
  });

  it("filters as an IN per key, booleans included, and projects", async () => {
    await db.addRecords("Sessions", [
      { Uid: "a", HasRecording: true, RecordingMime: "A" },
      { Uid: "b", HasRecording: false, RecordingMime: "B" },
      { Uid: "c", RecordingMime: "C" },
    ]);
    const uids = async (f: Record<string, unknown>) =>
      (await db.listRecords("Sessions", f)).map((r) => r.fields.Uid);
    expect(await uids({ Uid: ["a", "c"] })).toEqual(["a", "c"]);
    expect(await uids({ HasRecording: [true] })).toEqual(["a"]);
    expect(await uids({ Uid: [] })).toEqual([]);
    const [p] = await db.listRecords(
      "Sessions",
      { Uid: "b" },
      { fields: ["RecordingMime"] },
    );
    expect(p.fields).toEqual({ RecordingMime: "B" });
  });

  it("patches by merging, and refuses a row that is not there", async () => {
    const [{ id }] = await db.addRecords("Sessions", [
      { Uid: "a", RecordingMime: "x" },
    ]);
    await db.patchRecord("Sessions", id, { RecordingPath: "p" });
    const [rec] = await db.listRecords("Sessions");
    expect(rec.fields).toMatchObject({
      RecordingMime: "x",
      RecordingPath: "p",
    });
    expect(() => db.patchRecord("Sessions", "nope", {})).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it("keeps an id it is given, and writes all of a transaction or none", async () => {
    await db.addRecords("Sessions", [{ id: "kept", Uid: "a" }]);
    expect((await db.listRecords("Sessions"))[0].id).toBe("kept");
    expect(() =>
      db.inTransaction(() => {
        db.addRecords("Sessions", [{ Uid: "b" }]);
        db.deleteRecords("Sessions", ["kept"]);
        throw new Error("halfway");
      }),
    ).toThrow("halfway");
    expect(db.listRecords("Sessions").map((r) => r.id)).toEqual(["kept"]);
  });

  it("refuses an async function as a transaction, and rolls back what it wrote", async () => {
    expect(() =>
      db.inTransaction(async () => {
        db.addRecords("Sessions", [{ Uid: "b" }]);
      }),
    ).toThrow(/synchronous/);
    expect(db.listRecords("Sessions")).toEqual([]);
    // The connection is out of the failed transaction: the next write lands.
    db.addRecords("Sessions", [{ Uid: "c" }]);
    expect(db.listRecords("Sessions")).toHaveLength(1);
  });

  it("projects in SQL: zero values for missing fields, booleans back, filled texts as flags", () => {
    db.addRecords("Sessions", [
      { Uid: "a", HasRecording: true, RecordingPath: "la", Envelope: " \n " },
      { Uid: "b" },
    ]);
    const rows = db.listRecords("Sessions", undefined, {
      fields: ["Uid", "HasRecording", "Duration", "RecordingMime"],
      filled: ["RecordingPath", "Envelope"],
    });
    expect(rows.map((r) => r.fields)).toEqual([
      {
        Uid: "a",
        HasRecording: true,
        Duration: 0,
        RecordingMime: "",
        RecordingPath: true,
        Envelope: false,
      },
      {
        Uid: "b",
        HasRecording: false,
        Duration: 0,
        RecordingMime: "",
        RecordingPath: false,
        Envelope: false,
      },
    ]);
    expect(db.listRecords("Sessions", undefined, { fields: [] })).toHaveLength(
      2,
    );
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
