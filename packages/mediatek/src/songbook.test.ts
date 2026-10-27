// A song's lyrics, tablature and sheets live in its library folder: a song with one of them is a
// songbook song, its id is the sidecar's uuid, and moving it into a library song carries them all.

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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushIndex, listFamilyFresh } from "./catalogue.ts";
import { ensureLayout } from "./layout.ts";
import { bumped } from "./revision.ts";
import {
  addSongbookSheet,
  createSongbook,
  deleteSongbook,
  detachSongbook,
  listSongbook,
  moveSongbook,
  patchSongbook,
  readSongbook,
  removeSongbookSheet,
  SongbookRefusedError,
  setSongbookMaster,
} from "./songbook.ts";
import { readMasterTags, writeMasterTags } from "./tags.ts";
import { tinyWav } from "./testWav.ts";
import { addSong } from "./write.ts";

let root: string;
const at = (rel: string) => join(root, ...rel.split("/"));
const sidecar = (rel: string) => readFileSync(at(`${rel}/song.yaml`), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mt-songbook-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  // A fresh root per test: without this one is served the last one's listing.
  bumped("songs");
});
afterEach(async () => {
  await flushIndex();
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

describe("a song with no audio", () => {
  it("is filed where an upload of its names would land, named by its sidecar", async () => {
    const { id, path } = createSongbook({
      artist: "Nirvana",
      title: "Lithium",
      owner: "u1",
    });
    expect(path).toBe("songs/Nirvana/Album inconnu/Lithium");
    expect(sidecar(path)).toContain(`uuid: ${id}`);
    const song = await readSongbook(id);
    expect(song).toMatchObject({
      artist: "Nirvana",
      title: "Lithium",
      master: null,
      lyrics: "",
      facts: { owner: "u1" },
    });
  });

  it("is listed in the songbook only once it carries lyrics, a tablature or a sheet", async () => {
    const { id } = createSongbook({ artist: "A", title: "T", owner: "u1" });
    expect(await listSongbook()).toEqual([]);
    await patchSongbook(id, { lyrics: "[C]Hello" });
    expect(await listSongbook()).toMatchObject([
      { id, artist: "A", title: "T", hasLyrics: true, owner: "u1" },
    ]);
    // An emptied text is no attachment: the file goes, and the song with it from the list.
    await patchSongbook(id, { lyrics: "" });
    expect(existsSync(at("songs/A/Album inconnu/T/lyrics.txt"))).toBe(false);
    expect(await listSongbook()).toEqual([]);
  });

  it("takes a second folder for the same names rather than sharing one", () => {
    const a = createSongbook({ artist: "A", title: "T", owner: "u1" });
    const b = createSongbook({ artist: "A", title: "T", owner: "u2" });
    expect(b.path).toBe("songs/A/Album inconnu/T (2)");
    expect(b.id).not.toBe(a.id);
  });

  it("keeps its names in the sidecar when renamed, since it has no tags", async () => {
    const { id, path } = createSongbook({ artist: "A", title: "T", owner: "" });
    await patchSongbook(id, { title: "Renamed" });
    expect((await readSongbook(id))?.title).toBe("Renamed");
    expect(sidecar(path)).toContain("title: Renamed");
  });
});

describe("texts, sheets and bookkeeping", () => {
  it("writes the texts beside the master and the facts in the sidecar, comments kept", async () => {
    const { id, path } = createSongbook({
      artist: "A",
      title: "T",
      owner: "u",
    });
    writeFileSync(
      at(`${path}/song.yaml`),
      `# a note somebody wrote\n${sidecar(path)}`,
    );
    const song = await patchSongbook(id, {
      lyrics: "{{00:12}} [Am]line",
      tablature: "e|--0--|",
      lyricsMatch: "matched",
      fetchIgnored: true,
      fetch: { phase: "searching", huntId: "h1" },
    });
    expect(readFileSync(at(`${path}/lyrics.txt`), "utf8")).toBe(
      "{{00:12}} [Am]line",
    );
    expect(readFileSync(at(`${path}/tabs.txt`), "utf8")).toBe("e|--0--|");
    expect(song.facts).toMatchObject({
      lyricsMatch: "matched",
      fetchIgnored: true,
      fetch: { phase: "searching", huntId: "h1", progress: null },
    });
    expect(sidecar(path)).toContain("# a note somebody wrote");
    // Cleared fields leave the sidecar rather than staying as empty strings.
    await patchSongbook(id, { fetch: { phase: "", huntId: "" } });
    expect(sidecar(path)).not.toContain("huntId");
  });

  it("keeps the CHORDS in a text of their own, apart from the lyrics, and an emptied one leaves", async () => {
    const { id, path } = createSongbook({ artist: "A", title: "T", owner: "" });
    const song = await patchSongbook(id, {
      lyrics: "words only",
      chords: "[G]words [C]and chords",
    });
    expect(song.chords).toBe("[G]words [C]and chords");
    expect(song.lyrics).toBe("words only");
    expect(readFileSync(at(`${path}/chords.txt`), "utf8")).toBe(
      "[G]words [C]and chords",
    );
    await patchSongbook(id, { chords: "" });
    expect(existsSync(at(`${path}/chords.txt`))).toBe(false);
  });

  it("keeps sheets in order, under their own names, and removes one with its file", async () => {
    const { id, path } = createSongbook({ artist: "A", title: "T", owner: "" });
    await addSongbookSheet(id, {
      bytes: Buffer.from("%PDF"),
      name: "Score.pdf",
      mime: "application/pdf",
    });
    const song = await addSongbookSheet(id, {
      bytes: Buffer.from("%PDF2"),
      name: "Score.pdf",
      mime: "application/pdf",
    });
    expect(song.facts.sheets.map((s) => s.file)).toEqual([
      "sheets/Score.pdf",
      "sheets/Score 2.pdf",
    ]);
    expect((await listSongbook())[0].sheetCount).toBe(2);
    const [first] = song.facts.sheets;
    await removeSongbookSheet(id, first.id);
    expect(existsSync(at(`${path}/sheets/Score.pdf`))).toBe(false);
    expect((await readSongbook(id))?.facts.sheets).toHaveLength(1);
  });
});

describe("audio", () => {
  it("an uploaded track becomes the folder's master, its names moving into its tags", async () => {
    const { id, path } = createSongbook({ artist: "A", title: "T", owner: "" });
    await patchSongbook(id, { lyrics: "la" });
    const tmp = join(root, "up.wav");
    writeFileSync(tmp, tinyWav());
    const song = await setSongbookMaster(id, {
      filename: "whatever.wav",
      bytes: { file: tmp },
    });
    expect(song.master).toBe(`${path}/original.wav`);
    expect(await readMasterTags(at(`${path}/original.wav`))).toMatchObject({
      artist: "A",
      title: "T",
    });
    expect(sidecar(path)).not.toMatch(/^title:/m);
    expect(song.lyrics).toBe("la");
  });

  it("an upload by the library's own button into a songbook folder keeps the songbook", async () => {
    const { id, path } = createSongbook({ artist: "A", title: "T", owner: "" });
    await patchSongbook(id, { lyrics: "la" });
    await addSong({
      filename: "x.wav",
      bytes: tinyWav(),
      tags: { artist: "A", title: "T" },
    });
    expect(sidecar(path)).toContain(`uuid: ${id}`);
    expect(sidecar(path)).toContain("songbook:");
    expect((await readSongbook(id))?.master).toBe(`${path}/original.wav`);
  });

  it("moving into a library song carries the texts and sheets, and drops the empty folder", async () => {
    await addSong({
      filename: "x.wav",
      bytes: tinyWav(),
      tags: { artist: "Nirvana", album: "Nevermind", title: "Lithium" },
    });
    const target = "songs/Nirvana/Nevermind/Lithium";
    const { id, path } = createSongbook({
      artist: "Nirvana",
      title: "Lithium",
      owner: "u",
    });
    await patchSongbook(id, { lyrics: "la", tablature: "tab" });
    await addSongbookSheet(id, {
      bytes: Buffer.from("x"),
      name: "s.png",
      mime: "image/png",
    });
    const song = await moveSongbook(id, target);
    expect(song).toMatchObject({
      id,
      path: target,
      master: `${target}/original.wav`,
      lyrics: "la",
      tablature: "tab",
    });
    expect(song.facts.sheets[0].file).toBe("sheets/s.png");
    expect(existsSync(at(path))).toBe(false);
    // The library's own sidecar keeps its source; the songbook joins it.
    expect(sidecar(target)).toContain('source: "upload"');
  });

  it("refuses to move onto another songbook song, and onto a folder that is not a song", async () => {
    const a = createSongbook({ artist: "A", title: "T", owner: "" });
    const b = createSongbook({ artist: "B", title: "U", owner: "" });
    await expect(moveSongbook(a.id, b.path)).rejects.toBeInstanceOf(
      SongbookRefusedError,
    );
    mkdirSync(at("songs/X/Y/Z"), { recursive: true });
    await expect(moveSongbook(a.id, "songs/X/Y/Z")).rejects.toBeInstanceOf(
      SongbookRefusedError,
    );
  });

  it("detaching leaves the audio where it is and takes the songbook to a folder of its own", async () => {
    const tmp = join(root, "up.wav");
    writeFileSync(tmp, tinyWav());
    const { id, path } = createSongbook({ artist: "A", title: "T", owner: "" });
    await patchSongbook(id, { lyrics: "la" });
    await setSongbookMaster(id, { filename: "a.wav", bytes: { file: tmp } });
    const song = await detachSongbook(id);
    expect(song.master).toBeNull();
    expect(song.path).toBe(`${path} (2)`);
    expect(song.lyrics).toBe("la");
    expect(existsSync(at(`${path}/original.wav`))).toBe(true);
    expect(sidecar(path)).not.toContain("uuid");
  });
});

describe("deleting", () => {
  it("removes a folder with no audio whole, and only the songbook from one with a master", async () => {
    const bare = createSongbook({ artist: "A", title: "T", owner: "" });
    await patchSongbook(bare.id, { lyrics: "la" });
    await deleteSongbook(bare.id);
    expect(existsSync(at(bare.path))).toBe(false);

    await addSong({
      filename: "x.wav",
      bytes: tinyWav(),
      tags: { artist: "B", title: "U" },
    });
    await writeMasterTags(at("songs/B/Album inconnu/U/original.wav"), {
      title: "U",
    });
    const kept = createSongbook({
      artist: "B",
      title: "U",
      owner: "",
      folder: "songs/B/Album inconnu/U",
    });
    await patchSongbook(kept.id, { lyrics: "la" });
    await deleteSongbook(kept.id);
    expect(existsSync(at(`${kept.path}/original.wav`))).toBe(true);
    expect(existsSync(at(`${kept.path}/lyrics.txt`))).toBe(false);
    expect(
      (await listFamilyFresh("songs")).entries[0].meta?.uuid,
    ).toBeUndefined();
  });
});
