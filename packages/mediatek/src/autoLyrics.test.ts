// An unattended lyrics lookup: who is due one, how long a miss holds the next back, and what a hit
// leaves in the song's folder.

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
import {
  LYRICS_ERROR_RETRY_MS,
  LYRICS_RETRY_MS,
  lyricsQuery,
  recordFoundLyrics,
  recordLyricsMiss,
} from "./autoLyrics.ts";
import { flushIndex } from "./catalogue.ts";
import { ensureLayout } from "./layout.ts";
import { bumped } from "./revision.ts";
import { readSongbookAt } from "./songbook.ts";
import { writeMasterTags } from "./tags.ts";
import { tinyWav } from "./testWav.ts";

let root: string;
const at = (rel: string) => join(root, ...rel.split("/"));
const SONG = "songs/Nina Simone/Pastel Blues/Sinnerman";

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mt-autolyrics-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  bumped("songs");
  mkdirSync(at(SONG), { recursive: true });
  writeFileSync(at(`${SONG}/original.wav`), tinyWav());
  writeFileSync(at(`${SONG}/song.yaml`), 'source: "upload"\n');
  await writeMasterTags(at(`${SONG}/original.wav`), {
    artist: "Nina Simone",
    title: "Sinnerman",
  });
});
afterEach(async () => {
  await flushIndex();
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

describe("who is due a lookup", () => {
  it("a song with a master and no lyrics, asked by its tags and its length", async () => {
    const q = await lyricsQuery(SONG);
    expect(q).toMatchObject({
      folder: SONG,
      artist: "Nina Simone",
      title: "Sinnerman",
    });
    expect(q?.duration).toBeGreaterThan(0);
  });

  it("nobody with lyrics already, with no master, or under the K7 releases", async () => {
    writeFileSync(at(`${SONG}/lyrics.txt`), "la");
    expect(await lyricsQuery(SONG)).toBeNull();
    mkdirSync(at("songs/A/B/Bare"), { recursive: true });
    writeFileSync(at("songs/A/B/Bare/song.yaml"), "uuid: x\n");
    expect(await lyricsQuery("songs/A/B/Bare")).toBeNull();
    mkdirSync(at("songs/K7/R/V"), { recursive: true });
    writeFileSync(at("songs/K7/R/V/original.wav"), tinyWav());
    expect(await lyricsQuery("songs/K7/R/V")).toBeNull();
  });

  it("a miss holds the next lookup back a week, and no longer", async () => {
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    recordLyricsMiss(SONG, "not-found", t0);
    expect(readFileSync(at(`${SONG}/song.yaml`), "utf8")).toContain(
      "result: not-found",
    );
    expect(await lyricsQuery(SONG, t0 + LYRICS_RETRY_MS - 1)).toBeNull();
    expect(await lyricsQuery(SONG, t0 + LYRICS_RETRY_MS)).not.toBeNull();
  });

  it("an outage holds it back an hour only: it says nothing about the song", async () => {
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    recordLyricsMiss(SONG, "error", t0);
    expect(await lyricsQuery(SONG, t0 + LYRICS_ERROR_RETRY_MS - 1)).toBeNull();
    expect(await lyricsQuery(SONG, t0 + LYRICS_ERROR_RETRY_MS)).not.toBeNull();
  });

  it("an instrumental is never looked up again", async () => {
    recordLyricsMiss(SONG, "instrumental", 0);
    expect(await lyricsQuery(SONG, Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

describe("what a hit leaves", () => {
  it("the lyrics beside the master, the song in the songbook, the miss forgotten", async () => {
    recordLyricsMiss(SONG, "not-found", 0);
    const q = await lyricsQuery(SONG, LYRICS_RETRY_MS);
    if (!q) throw new Error("not due");
    recordFoundLyrics(q, { lyrics: "{{00:11.63}} Oh sinnerman", timed: true });
    expect(readFileSync(at(`${SONG}/lyrics.txt`), "utf8")).toBe(
      "{{00:11.63}} Oh sinnerman",
    );
    const sidecar = readFileSync(at(`${SONG}/song.yaml`), "utf8");
    expect(sidecar).not.toContain("lyricsSearch");
    expect(sidecar).toContain('source: "upload"');
    const song = await readSongbookAt(SONG);
    expect(song.title).toBe("Sinnerman");
    expect(song.facts.lyricsMatch).toBe("matched");
    expect(existsSync(at(`${SONG}/original.wav`))).toBe(true);
  });
});
