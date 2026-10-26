// findSongs only reads the disk, so it's tested here directly; pushSong itself (the
// actual upload) is exercised manually against a real server — see the commit that added this.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeMasterTags } from "../src/tags.ts";
import { tinyWav } from "../src/testWav.ts";
import { findSongs } from "./uploadLibrary.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "upload-library-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function song(
  artist: string,
  album: string,
  title: string,
  file = "track.mp3",
) {
  const dir = join(root, artist, album, title);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), "bytes");
  return dir;
}

describe("findSongs", () => {
  it("names a song from its own three folders", async () => {
    song("Miles Davis", "Kind of Blue", "So What");
    expect(await findSongs(root)).toEqual([
      {
        master: join(root, "Miles Davis/Kind of Blue/So What/track.mp3"),
        artist: "Miles Davis",
        album: "Kind of Blue",
        title: "So What",
      },
    ]);
  });

  it("finds several songs across several albums and artists", async () => {
    song("A", "X", "1");
    song("A", "X", "2");
    song("B", "Y", "3");
    expect((await findSongs(root)).map((s) => s.title).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("skips a title folder with no audio file in it", async () => {
    const dir = join(root, "A", "X", "empty");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not audio");
    expect(await findSongs(root)).toEqual([]);
  });

  it("takes an older tree's song.yaml over the folder's own names", async () => {
    const dir = song("unknown", "unknown", "track1");
    writeFileSync(
      join(dir, "song.yaml"),
      "artist: Real Artist\nalbum: Real Album\ntitle: Real Title\n",
    );
    expect((await findSongs(root))[0]).toMatchObject({
      artist: "Real Artist",
      album: "Real Album",
      title: "Real Title",
    });
  });

  it("prefers the master's own tags over a sidecar and the folder names", async () => {
    const dir = song("unknown", "unknown", "track1", "track.wav");
    writeFileSync(join(dir, "track.wav"), tinyWav());
    await writeMasterTags(join(dir, "track.wav"), { artist: "From Tags" });
    writeFileSync(join(dir, "song.yaml"), "artist: Old\ntitle: Old Title\n");
    expect((await findSongs(root))[0]).toMatchObject({
      artist: "From Tags",
      album: "unknown",
      title: "Old Title",
    });
  });

  it("falls back to the folder names for a sidecar field left blank", async () => {
    const dir = song("Artist", "Album", "Title");
    writeFileSync(join(dir, "song.yaml"), "album: Real Album\n");
    expect((await findSongs(root))[0]).toMatchObject({
      artist: "Artist",
      album: "Real Album",
      title: "Title",
    });
  });

  it("falls back to the folder names for an unreadable sidecar", async () => {
    const dir = song("Artist", "Album", "Title");
    writeFileSync(join(dir, "song.yaml"), "not: [valid: yaml");
    expect((await findSongs(root))[0]).toMatchObject({
      artist: "Artist",
      album: "Album",
      title: "Title",
    });
  });

  it("returns nothing for a root with no song hierarchy at all", async () => {
    expect(await findSongs(root)).toEqual([]);
  });

  it("picks the first audio file when a folder holds more than one", async () => {
    const dir = join(root, "A", "X", "multi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.flac"), "bytes");
    writeFileSync(join(dir, "b.wav"), "bytes");
    expect(await findSongs(root)).toHaveLength(1);
  });
});
