import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { inProcessSongbook } from "./inProcessSongbook.ts";

// The library answered in this process, over a temporary volume — see inProcessSongbook.ts.
vi.mock("./mediatek.ts", async (actual) => ({
  ...(await actual<typeof import("./mediatek.ts")>()),
  songbook: () => inProcessSongbook(),
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
const { tinyWav } = await import("@studio/mediatek/testWav");
ensureLayout();

afterAll(() => {
  db.store.close();
  rmSync(dir, { recursive: true, force: true });
});

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

  it("lists songbook rows without their texts, once they carry one", async () => {
    const song = await store.createSong("me", { artist: "A", title: "T" });
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

  it("keeps a sheet in the song's folder and serves it from there", async () => {
    const song = await store.createSong("me", { artist: "S", title: "Sheet" });
    if (!song) throw new Error("no song");
    const upload = join(dir, "score.pdf");
    writeFileSync(upload, "%PDF-1");
    const withSheet = await store.addSheetFiles(song.id, [
      { file: upload, mime: "application/pdf", name: "score.pdf" },
    ]);
    const [sheet] = withSheet?.sheets ?? [];
    expect(sheet).toMatchObject({ name: "score.pdf", mime: "application/pdf" });
    const cached = await store.ensureSheetFileCached(song.id, sheet.id);
    expect(readFileSync(cached?.filePath as string, "utf8")).toBe("%PDF-1");
    expect((await store.listSongs()).map((s) => s.id)).toContain(song.id);
  });

  it("takes an uploaded track as the folder's master, and leaves it behind when unlinked", async () => {
    const song = await store.createSong("me", { artist: "R", title: "Ref" });
    if (!song) throw new Error("no song");
    await store.updateSong(song.id, { lyrics: "la" });
    const upload = join(dir, "take.wav");
    writeFileSync(upload, tinyWav());
    const linked = await store.setSongAudio(song.id, {
      file: upload,
      mime: "audio/wav",
      name: "take.wav",
    });
    expect(linked?.audio?.path).toBe("songs/R/Album inconnu/Ref/original.wav");
    const unlinked = await store.unlinkSongAudio(song.id);
    expect(unlinked?.audio).toBeNull();
    expect(unlinked?.lyrics).toBe("la");
    // The library keeps the file; the song moved to a folder of its own.
    expect(
      readFileSync(join(dir, "library/songs/R/Album inconnu/Ref/original.wav"))
        .length,
    ).toBeGreaterThan(0);
  });
});
