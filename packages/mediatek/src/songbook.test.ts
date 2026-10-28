// A song's lyrics, tablature and sheets live in its library folder, under the id its sidecar's
// uuid names — mediatek's docs/songbook.md.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureLayout } from "./layout.ts";
import { bumped } from "./revision.ts";
import {
  addSongbookSheet,
  createSongbook,
  patchSongbook,
  readSongbook,
  removeSongbookSheet,
  setSongbookMaster,
} from "./songbook.ts";
import { readMasterTags } from "./tags.ts";
import { removeLibrary } from "./testLibrary.ts";
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
  delete process.env.STUDIO_MEDIATEK;
  await removeLibrary(root);
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

  it("writes a text beside the master, and removes it when emptied", async () => {
    const { id } = createSongbook({ artist: "A", title: "T", owner: "u1" });
    await patchSongbook(id, { lyrics: "[C]Hello" });
    expect(readFileSync(at("songs/A/Album inconnu/T/lyrics.txt"), "utf8")).toBe(
      "[C]Hello",
    );
    // An emptied text is no attachment: the file goes with it.
    await patchSongbook(id, { lyrics: "" });
    expect(existsSync(at("songs/A/Album inconnu/T/lyrics.txt"))).toBe(false);
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

  it("times the chords from the lyrics, whichever of the two is written last", async () => {
    const { id } = createSongbook({ artist: "A", title: "Timed", owner: "" });
    const timedLyrics = "{{00:10.00}} Hello world\n{{00:20.00}} Goodbye moon";
    const chordsTyped = "G       C\nHello world\nD\nGoodbye moon";
    // Lyrics first, chords after.
    await patchSongbook(id, { lyrics: timedLyrics });
    const song = await patchSongbook(id, { chords: chordsTyped });
    expect(song.chords.split("\n")).toEqual([
      "G       C",
      "{{00:10.00}} Hello world",
      "D",
      "{{00:20.00}} Goodbye moon",
    ]);
    expect(song.facts.chordsMatch).toBe("matched");
    // The lyrics change their times: the chords follow.
    const again = await patchSongbook(id, {
      lyrics: "{{00:11.00}} Hello world\n{{00:21.00}} Goodbye moon",
    });
    expect(again.chords).toContain("{{00:11.00}} Hello world");
  });

  it("leaves the chords as typed when the lyrics carry no time", async () => {
    const { id } = createSongbook({ artist: "A", title: "Plain", owner: "" });
    await patchSongbook(id, { lyrics: "Hello world" });
    const song = await patchSongbook(id, { chords: "[G]Hello world" });
    expect(song.chords).toBe("[G]Hello world");
    expect(song.facts.chordsMatch).toBe("");
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
});
