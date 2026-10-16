import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The store is opened at import, so the environment is set before anything of it loads.
const dir = mkdtempSync(join(tmpdir(), "k7-store-"));
process.env.K7_DATA_DIR = dir;
const db = await import("./db.ts");
const store = await import("./store.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the store's lookups and writes", () => {
  it("finds a moment by its key and answers only its owner", async () => {
    const [{ id }] = db.addRecords("Comments", [
      {
        OwnerId: "me",
        SessionUid: "s0",
        StartSec: 1,
        EndSec: 2,
        SharedFrom: "srv",
      },
    ]);
    expect((await store.getMoment("me", id))?.id).toBe(id);
    expect(await store.getMoment("you", id)).toBeNull();
    expect(await store.momentSharedFrom("me", id)).toBe("srv");
    expect(await store.momentSharedFrom("you", id)).toBe("");
    expect(await store.deleteMoment("you", id)).toBe(false);
    expect(db.getRecord("Comments", id)).not.toBeNull();
    expect(await store.deleteMoment("me", id)).toBe(true);
    expect(db.getRecord("Comments", id)).toBeNull();
  });

  it("keeps a session's moment out of another session's reach", async () => {
    const [{ id }] = db.addRecords("Comments", [
      { OwnerId: "me", SessionUid: "s1", StartSec: 1, EndSec: 2 },
    ]);
    expect(await store.deleteAnnotation("s2", id)).toBe(false);
    expect(await store.updateAnnotation("s2", id, { text: "x" })).toBeNull();
    expect((await store.updateAnnotation("s1", id, { text: "x" }))?.text).toBe(
      "x",
    );
  });

  it("deletes a session with its markers, its moments kept", async () => {
    const session = await store.createSession("me");
    await store.addMarker(session.id, { atSec: 1, comment: "" }, "me");
    const [{ id: moment }] = db.addRecords("Comments", [
      { OwnerId: "me", SessionUid: session.id },
    ]);
    expect(await store.deleteSession(session.id)).toBe(true);
    expect(db.listRecords("Markers", { SessionUid: [session.id] })).toEqual([]);
    expect(db.getRecord("Comments", moment)).not.toBeNull();
  });

  it("lists songbook rows without their texts", async () => {
    const song = await store.createSong("me", {
      artist: "A",
      title: "T",
      private: false,
    });
    if (!song) throw new Error("no song");
    await store.updateSong(song.id, { lyrics: "la la", tablature: "  " });
    const [row] = (await store.listSongs("me")).filter((s) => s.id === song.id);
    expect(row).toMatchObject({
      hasLyrics: true,
      hasTablature: false,
      sheetCount: 0,
      mine: true,
    });
    expect(row).not.toHaveProperty("lyrics");
    expect((await store.getSong(song.id))?.lyrics).toBe("la la");
  });
});
