// The lyrics queue against a temporary library and a lookup that never leaves the process.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLayout } from "@studio/mediatek/layout";
import { writeMasterTags } from "@studio/mediatek/tags";
import { tinyWav } from "@studio/mediatek/testWav";
import { addSong } from "@studio/mediatek/write";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLyricsQueue,
  type LyricsLookup,
  songFolderOfAudio,
} from "./lyricsQueue.ts";

let root: string;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "k7-lyrics-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

/** A song filed as an upload files it, tagged with its names. */
async function song(artist: string, title: string): Promise<string> {
  const { path, master } = await addSong({
    filename: "x.wav",
    bytes: tinyWav(),
    tags: { artist, title },
  });
  await writeMasterTags(join(root, master), { artist, title });
  return path;
}

const lyricsOf = (folder: string) =>
  readFileSync(join(root, folder, "lyrics.txt"), "utf8");
const sidecarOf = (folder: string) =>
  readFileSync(join(root, folder, "song.yaml"), "utf8");

describe("the lyrics queue", () => {
  it("stores timed lyrics with their codes inline, asked by the song's names", async () => {
    const asked: string[] = [];
    const lookup: LyricsLookup = async (artist, title) => {
      asked.push(`${artist} / ${title}`);
      return { kind: "synced", text: "[00:11.63]Oh sinnerman" };
    };
    const q = createLyricsQueue(lookup, { spacingMs: 0 });
    const folder = await song("Nina Simone", "Sinnerman");
    q.want(folder);
    await q.idle();
    expect(asked).toEqual(["Nina Simone / Sinnerman"]);
    expect(lyricsOf(folder)).toBe("{{00:11.63}} Oh sinnerman");
  });

  it("marks a miss, and does not ask again before a week has passed", async () => {
    let clock = Date.parse("2026-10-01T00:00:00Z");
    let calls = 0;
    const lookup: LyricsLookup = async () => {
      calls++;
      return null;
    };
    const q = createLyricsQueue(lookup, { spacingMs: 0, now: () => clock });
    const folder = await song("A", "T");
    q.want(folder);
    await q.idle();
    expect(calls).toBe(1);
    expect(sidecarOf(folder)).toContain("result: not-found");

    // Played again the next day: the mark holds it back.
    clock += DAY;
    q.want(folder);
    await q.idle();
    expect(calls).toBe(1);

    // Played eight days later: asked again.
    clock += 7 * DAY;
    q.want(folder);
    await q.idle();
    expect(calls).toBe(2);
  });

  it("looks at a folder once for a burst of requests, the way a play sends them", async () => {
    let calls = 0;
    const q = createLyricsQueue(
      async () => {
        calls++;
        return null;
      },
      { spacingMs: 0 },
    );
    const folder = await song("A", "T");
    for (let i = 0; i < 5; i++) q.want(folder);
    await q.idle();
    expect(calls).toBe(1);
  });

  it("marks an unreachable service as a miss too, and an instrumental for good", async () => {
    const q = createLyricsQueue(
      async (_a, title) => {
        if (title === "Down") throw new Error("offline");
        return { kind: "instrumental" };
      },
      { spacingMs: 0 },
    );
    const down = await song("A", "Down");
    const inst = await song("A", "Instru");
    q.want(down);
    q.want(inst);
    await q.idle();
    expect(sidecarOf(down)).toContain("result: error");
    expect(sidecarOf(inst)).toContain("result: instrumental");
    expect(existsSync(join(root, inst, "lyrics.txt"))).toBe(false);
  });

  it("asks nothing for a song that has lyrics, or for a K7 release", async () => {
    let calls = 0;
    const q = createLyricsQueue(
      async () => {
        calls++;
        return null;
      },
      { spacingMs: 0 },
    );
    const k7 = await song("K7", "Release");
    q.want(k7);
    await q.idle();
    expect(calls).toBe(0);
  });

  it("does nothing at all with no lookup, as in a test run or an offline library", async () => {
    const q = createLyricsQueue(null);
    const folder = await song("A", "T");
    q.want(folder);
    await q.idle();
    expect(sidecarOf(folder)).not.toContain("lyricsSearch");
  });
});

describe("songFolderOfAudio", () => {
  it("is the folder of a song's file, and nothing outside the songs", () => {
    expect(songFolderOfAudio("songs/A/B/T/original.mp3")).toBe("songs/A/B/T");
    expect(songFolderOfAudio("recordings/2026-10-01/x.wav")).toBeNull();
  });
});
