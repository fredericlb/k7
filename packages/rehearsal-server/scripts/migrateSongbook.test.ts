// The one-shot move of the songbook from the rehearsal store into song folders: a song with a
// library track joins its folder, one without gets a folder of its own, its texts, sheets and
// bookkeeping come along, old timings are laid into the text, and a second run changes nothing.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlite } from "../src/sqlite.ts";
import { foldTimings, migrate } from "./migrateSongbook.ts";

const dir = mkdtempSync(join(tmpdir(), "k7-migrate-book-"));
const data = join(dir, "data");
const library = join(dir, "library");
const lib = (rel: string) => join(library, ...rel.split("/"));

beforeAll(async () => {
  process.env.STUDIO_MEDIATEK = library;
  const { ensureLayout } = await import("@studio/mediatek/layout");
  const { tinyWav } = await import("@studio/mediatek/testWav");
  ensureLayout();
  // A library song the first songbook song's track already is.
  mkdirSync(lib("songs/Nirvana/k7/Lithium (aaaa1111)"), { recursive: true });
  writeFileSync(
    lib("songs/Nirvana/k7/Lithium (aaaa1111)/original.wav"),
    tinyWav(),
  );

  const db = createSqlite(data);
  const [{ id: rec }] = db.addRecords("Songs", [
    {
      Uid: "aaaa1111-song",
      OwnerId: "alice",
      Artist: "Nirvana",
      Title: "Lithium",
      Lyrics: "[Am]I'm so happy\n[C]'cause today",
      LyricTimings: JSON.stringify([
        { line: 0, text: "i m so happy", t: 12.5 },
      ]),
      Tablature: "e|--0--|",
      SheetMeta: "[]",
      AudioPath: "songs/Nirvana/k7/Lithium (aaaa1111)/original.wav",
      InstrumentalPath:
        "songs/Nirvana/k7/Lithium (aaaa1111)/stems/instrumental.wav",
      LyricsMatch: "matched",
      Private: true,
      CreatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      Uid: "bbbb2222-song",
      OwnerId: "bob",
      Artist: "Bashung",
      Title: "Osez Joséphine",
      Lyrics: "",
      Tablature: "",
      SheetMeta: "[]",
    },
  ]);
  const sheet = db.uploadAttachment(
    Buffer.from("%PDF-1"),
    "application/pdf",
    "score.pdf",
    rec,
  );
  db.patchRecord("Songs", rec, {
    SheetMeta: JSON.stringify([
      {
        id: sheet,
        attachmentId: sheet,
        name: "score.pdf",
        mime: "application/pdf",
      },
    ]),
  });
  const [{ id: other }] = db.listRecords("Songs", { Uid: ["bbbb2222-song"] });
  const png = db.uploadAttachment(
    Buffer.from("PNG"),
    "image/png",
    "page 1.png",
    other,
  );
  db.patchRecord("Songs", other, {
    SheetMeta: JSON.stringify([
      { id: png, attachmentId: png, name: "page 1.png", mime: "image/png" },
    ]),
  });
  db.close();
});

afterAll(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(dir, { recursive: true, force: true });
});

describe("folding old timings into the text", () => {
  it("puts each stored time before its line, and leaves timed text alone", () => {
    const timings = JSON.stringify([{ line: 1, text: "hello", t: 3 }]);
    expect(foldTimings("[C]\nhello\nworld", timings)).toBe(
      "[C]\n{{00:03.00}} hello\nworld",
    );
    expect(foldTimings("{{00:01}} hello", timings)).toBe("{{00:01}} hello");
    expect(foldTimings("hello", "not json")).toBe("hello");
  });
});

describe("migrating the songbook", () => {
  it("reports where each song would go and writes nothing on a dry run", async () => {
    const out = await migrate({ dataDir: data, dry: true });
    expect(out.map((o) => [o.uid, o.folder])).toEqual([
      ["aaaa1111-song", "songs/Nirvana/k7/Lithium (aaaa1111)"],
      ["bbbb2222-song", "songs/Bashung/Album inconnu/Osez Josephine"],
    ]);
    expect(out[0].notes).toContain("was private, public now");
    expect(
      existsSync(lib("songs/Nirvana/k7/Lithium (aaaa1111)/lyrics.txt")),
    ).toBe(false);
  });

  it("files each song with its texts, sheets and bookkeeping", async () => {
    await migrate({ dataDir: data, dry: false });
    const book = await import("@studio/mediatek/songbook");

    const lithium = await book.readSongbook("aaaa1111-song");
    expect(lithium).toMatchObject({
      path: "songs/Nirvana/k7/Lithium (aaaa1111)",
      master: "songs/Nirvana/k7/Lithium (aaaa1111)/original.wav",
      tablature: "e|--0--|",
      facts: {
        owner: "alice",
        lyricsMatch: "matched",
        createdAt: "2026-01-01T00:00:00.000Z",
        instrumental:
          "songs/Nirvana/k7/Lithium (aaaa1111)/stems/instrumental.wav",
      },
    });
    expect(lithium?.lyrics.split("\n")[0]).toBe(
      "{{00:12.50}} [Am]I'm so happy",
    );
    const [pdf] = lithium?.facts.sheets ?? [];
    expect(
      readFileSync(
        lib(`songs/Nirvana/k7/Lithium (aaaa1111)/${pdf.file}`),
        "utf8",
      ),
    ).toBe("%PDF-1");

    const osez = await book.readSongbook("bbbb2222-song");
    expect(osez).toMatchObject({
      path: "songs/Bashung/Album inconnu/Osez Josephine",
      master: null,
      artist: "Bashung",
      title: "Osez Joséphine",
      facts: { owner: "bob" },
    });
    expect(osez?.facts.sheets.map((s) => s.name)).toEqual(["page 1.png"]);
    expect((await book.listSongbook()).map((s) => s.id).sort()).toEqual([
      "aaaa1111-song",
      "bbbb2222-song",
    ]);
  });

  it("changes nothing the second time", async () => {
    const book = await import("@studio/mediatek/songbook");
    const before = await book.readSongbook("aaaa1111-song");
    await migrate({ dataDir: data, dry: false });
    expect(await book.readSongbook("aaaa1111-song")).toEqual(before);
    expect(
      (await book.readSongbook("bbbb2222-song"))?.facts.sheets,
    ).toHaveLength(1);
  });
});
