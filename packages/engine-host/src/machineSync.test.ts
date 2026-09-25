// machineSync.test.ts — a set list copied onto a `file://` target on THIS machine, each song
// fetched through the channel as it goes: what is there already is skipped, a missing song is one
// line and not a failed run, the m3u lands only in a folder the target already has, and the
// target is named, never given as a URI.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSyncTargets } from "@studio/song/preferences";
import type { SyncJob } from "@studio/web-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { syncJobs } from "./machineSync.ts";

describe("a sync onto this machine's target", () => {
  let lib: string;
  let stick: string;
  let fetched: string[];

  beforeEach(() => {
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "sync-home-"));
    lib = mkdtempSync(join(tmpdir(), "sync-lib-"));
    stick = mkdtempSync(join(tmpdir(), "sync-stick-"));
    fetched = [];
    setSyncTargets([{ name: "stick", uri: `file://${stick}` }]);
    mkdirSync(join(lib, "songs", "A", "Al", "One"), { recursive: true });
    writeFileSync(join(lib, "songs", "A", "Al", "One", "original.mp3"), "ONE");
  });

  const run = async (req: Record<string, unknown>) => {
    const replies: Record<string, unknown>[] = [];
    await syncJobs.sync(
      { type: "sync", id: "r1", ...req },
      (r) => replies.push(r),
      // Stands in for the tunnel: the file is "brought down" when the library has it.
      {
        fetch: async (local) => {
          fetched.push(local);
          return existsSync(local);
        },
      },
    );
    return replies.map((r) => r.job as SyncJob);
  };

  it("copies what is missing, reports as it goes, and says what it could not find", async () => {
    mkdirSync(join(stick, "playlists"));
    const jobs = await run({
      target: "stick",
      playlist: "gig",
      root: lib,
      tracks: [
        {
          path: "songs/A/Al/One/original.mp3",
          artist: "A",
          album: "Al",
          title: "One",
        },
        {
          path: "songs/B/Bl/Gone/original.mp3",
          artist: "B",
          album: "Bl",
          title: "Gone",
        },
      ],
    });
    const last = jobs.at(-1) as SyncJob;
    expect(jobs.length).toBeGreaterThan(2);
    expect(last).toMatchObject({
      id: "r1",
      done: true,
      failed: false,
      copied: 1,
      skipped: 0,
      total: 2,
    });
    expect(last.lines).toEqual(["Gone: not in the médiathèque"]);
    expect(last.m3u).toBe("playlists/gig.m3u");
    expect(fetched).toHaveLength(2);
  });

  it("skips a track already there, and writes no m3u where there is no folder for one", async () => {
    const tracks = [
      {
        path: "songs/A/Al/One/original.mp3",
        artist: "A",
        album: "Al",
        title: "One",
      },
    ];
    await run({ target: "stick", playlist: "gig", root: lib, tracks });
    const last = (
      await run({ target: "stick", playlist: "gig", root: lib, tracks })
    ).at(-1) as SyncJob;
    expect(last).toMatchObject({ copied: 0, skipped: 1, m3u: null });
  });

  it("knows its targets by name only, and blanks their passwords in the listing", async () => {
    setSyncTargets([
      { name: "stick", uri: `file://${stick}` },
      { name: "box", uri: "ftp://dj:secret@192.168.1.9/music" },
    ]);
    const replies: Record<string, unknown>[] = [];
    await syncJobs["sync-targets"](
      { type: "sync-targets" },
      (r) => replies.push(r),
      {
        fetch: async () => false,
      },
    );
    expect(JSON.stringify(replies)).not.toContain("secret");
    await expect(
      run({ target: "nope", playlist: "gig", root: lib, tracks: [] }),
    ).rejects.toThrow(/no sync target named 'nope'/);
    expect(
      readFileSync(
        join(lib, "songs", "A", "Al", "One", "original.mp3"),
        "utf8",
      ),
    ).toBe("ONE");
  });
});
