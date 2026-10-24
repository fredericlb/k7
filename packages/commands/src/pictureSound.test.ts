// `picture sound` — a picture lane's shots made audible through an engine lane. What would go
// wrong silently: a rerun making a second lane, a clip's existing `sound:` extracted over, and a
// new lane keeping the `events: []` that a sounding lane may not state, and a removed sound clip
// that takes its shot's picture with it.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@studio/k7x/document";
import { compileNodeProject } from "@studio/song/nodeProject";
import { writeDoc, writeLane } from "@studio/song/testSupport";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import { beatsToPosition } from "@studio/song-schema/timecode";
import { listVideoPlacements } from "@studio/song-schema/yaml/videoTrackFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "node-demo.k7");

let song: string;
const logs: string[] = [];
const refusals: string[] = [];
const host = () =>
  ({
    songPath: song,
    project: () => compileNodeProject(song),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
  }) as never;

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  song = mkdtempSync(join(tmpdir(), "td-psound-"));
  cpSync(SONG, song, { recursive: true });
  writeLane(song, "main", "picture-track", {
    events: [{ ref: "shot", start: 0, length: 2 }],
  });
});
afterEach(() => rmSync(song, { recursive: true, force: true }));

describe("picture sound", () => {
  it("reuses a clip's stated sound, and makes ONE lane however often it runs", async () => {
    writeDoc(join(song, "clips", "shot.k7x"), {
      source: "clips/shot.mp4",
      sound: "clips/shot-take.wav",
    });
    writeFileSync(join(song, "clips", "shot.mp4"), "");
    writeFileSync(join(song, "clips", "shot-take.wav"), "");
    await runCommand("picture sound main", host(), "cli");
    await runCommand("picture sound main", host(), "cli");
    expect(refusals).toEqual([]);
    expect(logs).toContain("main-sound already plays main's sound");
    const lane = wsRead(join(song, "nodes", "main-sound.k7x"));
    expect(lane).toContain('video_source("main")');
    expect(lane).not.toContain("events");
    const t = compileNodeProject(song).tracks.find(
      (x) => x.id === "main-sound",
    );
    expect(t?.clips.map((c) => c.source)).toEqual([
      join(song, "clips", "shot-take.wav"),
    ]);
  });

  it("sends an edit of the sounding lane's clip to the shot it comes from", async () => {
    writeDoc(join(song, "clips", "shot.k7x"), {
      source: "clips/shot.mp4",
      sound: "clips/shot.wav",
    });
    writeFileSync(join(song, "clips", "shot.mp4"), "");
    writeFileSync(join(song, "clips", "shot.wav"), "");
    await runCommand("picture sound main", host(), "cli");
    await runCommand("event move main-sound 1:1 2:1", host(), "cli");
    expect(refusals.join("\n")).toMatch(/plays main's sound — edit the shot/);
  });

  it("silences the shot when its sound clip is removed, and `picture silence` brings it back", async () => {
    writeLane(song, "main", "picture-track", {
      events: [
        { ref: "shot", start: 0, length: 2 },
        { ref: "shot", start: 4, length: 2 },
      ],
    });
    writeDoc(join(song, "clips", "shot.k7x"), {
      source: "clips/shot.mp4",
      sound: "clips/shot.wav",
    });
    writeFileSync(join(song, "clips", "shot.mp4"), "");
    writeFileSync(join(song, "clips", "shot.wav"), "");
    await runCommand("picture sound main", host(), "cli");
    const heard = () =>
      compileNodeProject(song)
        .tracks.find((x) => x.id === "main-sound")
        ?.clips.map((c) => c.start);
    const { tempo, timeSigNumerator, timeSigDenominator } =
      compileNodeProject(song);
    const second = beatsToPosition(
      (4 * tempo) / 60,
      timeSigNumerator,
      timeSigDenominator,
    );
    await runCommand(`event remove main-sound ${second}`, host(), "cli");
    expect(refusals).toEqual([]);
    expect(heard()).toEqual([0]);
    // The picture keeps both shots: only the second one's sound went.
    const shots = listVideoPlacements(wsRead(join(song, "nodes", "main.k7x")));
    expect(shots.map((x) => [x.start, x.silent])).toEqual([
      [0, undefined],
      [4, true],
    ]);
    await runCommand("picture silence main 4", host(), "cli");
    expect(heard()).toEqual([0, (4 * tempo) / 60]);
    await runCommand(
      'events remove [{"track":"main-sound","start":"1:1"}]',
      host(),
      "cli",
    );
    expect(refusals).toEqual([]);
    expect(heard()).toEqual([(4 * tempo) / 60]);
  });

  it("makes no lane when no shot has a sound", async () => {
    writeDoc(join(song, "clips", "shot.k7x"), { source: "clips/shot.webm" });
    await runCommand("picture sound main", host(), "cli");
    expect(logs).toContain("nothing on main has a sound — no lane made");
    expect(existsSync(join(song, "nodes", "main-sound.k7x"))).toBe(false);
  });

  it("refuses a lane that is not there", async () => {
    await runCommand("picture sound nope", host(), "cli");
    expect(refusals.join("\n")).toMatch(/no picture lane 'nope'/);
  });

  it.skipIf(!hasFfmpeg)(
    "extracts a video's sound beside it and names it on the clip",
    async () => {
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:d=0.5",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.5",
        "-shortest",
        join(song, "clips", "shot.mp4"),
      ]);
      writeDoc(join(song, "clips", "shot.k7x"), { source: "clips/shot.mp4" });
      await runCommand("picture sound main dialog", host(), "cli");
      expect(refusals).toEqual([]);
      expect(existsSync(join(song, "clips", "shot.sound.wav"))).toBe(true);
      expect(
        parse(readFileSync(join(song, "clips", "shot.k7x"), "utf8")).sound,
      ).toBe("clips/shot.sound.wav");
      expect(
        compileNodeProject(song).tracks.some((t) => t.id === "dialog"),
      ).toBe(true);
    },
  );
});
