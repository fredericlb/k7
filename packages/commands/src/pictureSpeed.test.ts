// A shot's speed as verbs. What would go wrong silently: a reverse written past the source's first
// frame, and a split or a head trim that moves the in-point at 1× under a shot running at 2×.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listVideoPlacements } from "@studio/song-schema/yaml/videoTrackFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let song: string;
const logs: string[] = [];
const refusals: string[] = [];
const host = () =>
  ({
    songPath: song,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
  }) as never;

const lane = (body: string) => {
  mkdirSync(join(song, "video_tracks"), { recursive: true });
  writeFileSync(join(song, "video_tracks", "main.k7x"), body, "utf8");
};
const read = () =>
  readFileSync(join(song, "video_tracks", "main.k7x"), "utf8");
const shots = () => listVideoPlacements(read());

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  song = mkdtempSync(join(tmpdir(), "td-pspeed-"));
});
afterEach(() => rmSync(song, { recursive: true, force: true }));

describe("picture speed", () => {
  it("writes the factor, and drops the key again at 1", async () => {
    lane(
      '// A-roll\nevents([ref("a").start(0).length(4).source_from(2)])\n',
    );
    await runCommand("picture speed main 0 0.5", host(), "cli");
    expect(shots()[0]?.speed).toBe(0.5);
    expect(read()).toContain("// A-roll");
    await runCommand("picture speed main 0 1", host(), "cli");
    expect(read()).not.toContain("speed");
  });

  it("refuses a reverse that runs back past the source's first frame", async () => {
    lane('events([ref("a").start(0).length(4).source_from(2)])\n');
    await runCommand("picture speed main 0 -1", host(), "cli");
    expect(refusals.join("\n")).toMatch(/runs out of source after 2s/);
    expect(read()).not.toContain("speed");
  });

  it("refuses an activation, which has no source to run", async () => {
    lane("events([start(0).length(4)])\n");
    await runCommand("picture speed main 0 2", host(), "cli");
    expect(refusals.join("\n")).toMatch(/ACTIVATION/);
  });
});

describe("edits under a speed", () => {
  it("splits at the shot's speed: the tail's in-point is the head's length × speed on", async () => {
    lane(
      'events([ref("a").start(0).length(4).source_from(1).speed(2)])\n',
    );
    await runCommand("picture split main 0 1.5", host(), "cli");
    expect(shots()[1]).toMatchObject({ start: 1.5, sourceFrom: 4, speed: 2 });
  });

  it("trims a head at the shot's speed, backwards too", async () => {
    lane(
      'events([ref("a").start(0).length(4).source_from(6).speed(-1)])\n',
    );
    await runCommand("picture head main 0 1", host(), "cli");
    // Running backwards, a head moved 1 s later starts 1 s EARLIER in the source.
    expect(shots()[0]).toMatchObject({ start: 1, sourceFrom: 5, length: 3 });
  });
});
