import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// The library answered in this process, over a temporary volume.
vi.mock("./mediatek.ts", async (actual) => ({
  ...(await actual<typeof import("./mediatek.ts")>()),
  download: async (path: string, dest: string) => {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(process.env.STUDIO_MEDIATEK as string, path), dest);
  },
}));

// The store and the library are opened at import, so the environment is set before anything loads.
const dir = mkdtempSync(join(tmpdir(), "k7-store-"));
process.env.K7_DATA_DIR = join(dir, "data");
process.env.STUDIO_MEDIATEK = join(dir, "library");
const db = await import("./db.ts");
const store = await import("./store.ts");
const { ensureLayout } = await import("@studio/mediatek/layout");
const { removeLibrary } = await import("@studio/mediatek/testLibrary");
ensureLayout();

afterAll(async () => {
  db.store.close();
  await removeLibrary(dir);
});

const TAKE = "recordings/2026-08-03/21-05-07.webm";

describe("the store's lookups and writes", () => {
  it("finds a moment by its key and answers only its owner", async () => {
    const [{ id }] = db.addRecords("Comments", [
      {
        OwnerId: "me",
        RecordingPath: TAKE,
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

  it("keeps a moment out of another account's reach", async () => {
    const [{ id }] = db.addRecords("Comments", [
      { OwnerId: "me", RecordingPath: TAKE, StartSec: 1, EndSec: 2 },
    ]);
    expect(await store.updateMoment("you", id, { text: "x" })).toBeNull();
    expect((await store.updateMoment("me", id, { text: "x" }))?.text).toBe("x");
  });

  it("deletes a session with its markers, its moments kept", async () => {
    const session = await store.createSession("me");
    await store.addMarker(session.id, { atSec: 1, comment: "" }, "me");
    const [{ id: moment }] = db.addRecords("Comments", [
      { OwnerId: "me", RecordingPath: TAKE },
    ]);
    expect(await store.deleteSession(session.id)).toBe(true);
    expect(db.listRecords("Markers", { SessionUid: [session.id] })).toEqual([]);
    expect(db.getRecord("Comments", moment)).not.toBeNull();
  });
});

describe("a moment names a recording, not a session", () => {
  const path = "recordings/2026-08-04/20-00-00.webm";

  it("gives a session the moments of the recording it saved, the owner's only", async () => {
    const session = await store.createSession("me");
    const row = db.listRecords("Sessions", { Uid: [session.id] })[0];
    db.patchRecord("Sessions", row.id, { RecordingPath: path });
    db.addRecords("Comments", [
      { OwnerId: "me", RecordingPath: path, StartSec: 5, EndSec: 6 },
      { OwnerId: "you", RecordingPath: path, StartSec: 1, EndSec: 2 },
      { OwnerId: "me", RecordingPath: TAKE, StartSec: 1, EndSec: 2 },
    ]);
    const got = await store.getSession(session.id);
    expect(got?.recordingPath).toBe(path);
    expect(got?.annotations.map((a) => a.startSec)).toEqual([5]);
    const page = store.recordingMoments("me", path);
    expect(page?.sessionId).toBe(session.id);
    expect(page?.moments.map((a) => a.startSec)).toEqual([5]);
  });

  it("files a moment on any capture, dated by the capture's own name", async () => {
    const other = "recordings/2026-08-05/09-30-00.mp3";
    const moment = await store.addMoment("me", other, {
      startSec: 10,
      endSec: 20,
    });
    expect(moment?.recordingPath).toBe(other);
    const row = db.getRecord("Comments", String(moment?.id));
    expect(row?.fields.RecordedAt).toBe(
      new Date(2026, 7, 5, 9, 30, 0).toISOString(),
    );
    expect(store.recordingMoments("me", other)?.sessionId).toBeNull();
  });

  it("refuses a path that is no capture", async () => {
    for (const bad of [
      "songs/a/b/c/original.mp3",
      "recordings/2026-08-05/moment-09-30-00--15.webm",
      "recordings/../k7.db",
    ])
      expect(
        await store.addMoment("me", bad, { startSec: 0, endSec: 1 }),
      ).toBeNull();
  });

  it("links an older row to its session's recording, once", async () => {
    const session = await store.createSession("me");
    const row = db.listRecords("Sessions", { Uid: [session.id] })[0];
    const legacyPath = "recordings/2026-08-06/21-00-00.webm";
    db.patchRecord("Sessions", row.id, { RecordingPath: legacyPath });
    const [{ id: linked }, { id: orphan }] = db.addRecords("Comments", [
      { OwnerId: "me", SessionUid: session.id, StartSec: 1, EndSec: 2 },
      {
        OwnerId: "me",
        SessionUid: "gone",
        SessionCreatedAt: "2026-01-01T20:00:00.000Z",
      },
    ]);
    expect(store.linkMomentsToRecordings()).toBeGreaterThanOrEqual(2);
    expect(db.getRecord("Comments", linked)?.fields).toMatchObject({
      RecordingPath: legacyPath,
      RecordedAt: session.createdAt,
      SessionUid: "",
    });
    expect(db.getRecord("Comments", orphan)?.fields).toMatchObject({
      RecordingPath: "",
      RecordedAt: "2026-01-01T20:00:00.000Z",
    });
    expect(store.linkMomentsToRecordings()).toBe(0);
  });
});
