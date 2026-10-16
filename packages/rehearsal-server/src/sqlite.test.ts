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

afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
    await expect(db.patchRecord("Songs", "nope", {})).rejects.toMatchObject({
      status: 404,
    });
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
    await expect(
      db.inTransaction(async () => {
        await db.addRecords("Songs", [{ Uid: "b" }]);
        throw new Error("halfway");
      }),
    ).rejects.toThrow("halfway");
    expect(await db.listRecords("Songs")).toHaveLength(1);
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
});
