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
  remove: async () => {},
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
    const path = "recordings/2026-08-07/20-00-00.webm";
    const row = db.listRecords("Sessions", { Uid: [session.id] })[0];
    db.patchRecord("Sessions", row.id, { RecordingPath: path });
    store.addRecordingMarker("me", path, { atSec: 1 });
    const [{ id: moment }] = db.addRecords("Comments", [
      { OwnerId: "me", RecordingPath: path },
    ]);
    expect(await store.deleteSession(session.id)).toBe(true);
    expect(db.listRecords("Markers", { RecordingPath: [path] })).toEqual([]);
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
    expect(store.linkToRecordings()).toBeGreaterThanOrEqual(2);
    expect(db.getRecord("Comments", linked)?.fields).toMatchObject({
      RecordingPath: legacyPath,
      RecordedAt: session.createdAt,
      SessionUid: "",
    });
    expect(db.getRecord("Comments", orphan)?.fields).toMatchObject({
      RecordingPath: "",
      RecordedAt: "2026-01-01T20:00:00.000Z",
    });
    expect(store.linkToRecordings()).toBe(0);
  });

  it("links an older pin to its session's recording, and drops one with nothing to pin", async () => {
    const session = await store.createSession("me");
    const row = db.listRecords("Sessions", { Uid: [session.id] })[0];
    const legacyPath = "recordings/2026-08-08/21-00-00.webm";
    db.patchRecord("Sessions", row.id, { RecordingPath: legacyPath });
    const [{ id: pin }, { id: lost }] = db.addRecords("Markers", [
      { OwnerId: "me", SessionUid: session.id, AtSec: 3 },
      { OwnerId: "me", SessionUid: "gone", AtSec: 4 },
    ]);
    store.linkToRecordings();
    expect(db.getRecord("Markers", pin)?.fields).toMatchObject({
      RecordingPath: legacyPath,
      SessionUid: "",
    });
    expect(db.getRecord("Markers", lost)).toBeNull();
    expect(
      (await store.getSession(session.id))?.markers.map((m) => m.atSec),
    ).toEqual([3]);
  });
});

describe("a recording's pins", () => {
  const path = "recordings/2026-08-09/10-00-00.mp3";

  it("pins any capture, its owner's alone, and never a moment's pin", () => {
    const pin = store.addRecordingMarker("me", path, {
      atSec: 2,
      comment: "a",
    });
    expect(pin).not.toBeNull();
    expect(
      store.addRecordingMarker("me", "songs/a/b.mp3", { atSec: 1 }),
    ).toBeNull();
    expect(
      store.updateRecordingMarker("you", String(pin?.id), { comment: "x" }),
    ).toBeNull();
    expect(
      store.updateRecordingMarker("me", String(pin?.id), { comment: "x" })
        ?.comment,
    ).toBe("x");
    expect(
      store.recordingMoments("me", path)?.markers.map((m) => m.comment),
    ).toEqual(["x"]);
    expect(store.recordingMoments("you", path)?.markers).toEqual([]);
    const [{ id: momentPin }] = db.addRecords("Markers", [
      { OwnerId: "me", MomentId: "m1", AtSec: 1 },
    ]);
    expect(store.deleteRecordingMarker("me", momentPin)).toBe(false);
    expect(store.deleteRecordingMarker("me", String(pin?.id))).toBe(true);
  });
});

describe("deleting a recording", () => {
  it("takes every session that saved it and their pins, the moments kept", async () => {
    const path = "recordings/2026-08-10/20-00-00.webm";
    const session = await store.createSession("you");
    const row = db.listRecords("Sessions", { Uid: [session.id] })[0];
    db.patchRecord("Sessions", row.id, { RecordingPath: path });
    store.addRecordingMarker("you", path, { atSec: 1 });
    const [{ id: moment }] = db.addRecords("Comments", [
      { OwnerId: "you", RecordingPath: path },
    ]);
    await store.deleteRecording(path);
    expect(db.listRecords("Sessions", { RecordingPath: [path] })).toEqual([]);
    expect(db.listRecords("Markers", { RecordingPath: [path] })).toEqual([]);
    expect(db.getRecord("Comments", moment)).not.toBeNull();
    expect(await store.getSession(session.id)).toBeNull();
  });
});
