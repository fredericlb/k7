import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "@studio/commands/commandSpec";
import { installServerSide } from "@studio/k7-sdk/install";
import { pictureLaneFile, pictureLaneIds } from "@studio/song/pictureLanes";
import { writeDoc, writeLane } from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { listVideoPlacements } from "@studio/song-schema/yaml/videoTrackFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transcriptionPlugin } from "./index";

// The whole walk, on a real folder: a picture lane holding a shot, the clip naming a REAL video
// (ffmpeg makes one — the same binary the verb decodes with), and a FAKE whisper on PATH that
// writes a fixture SRT. What is pinned is the file flow: which lane is listened to, where the
// text lands, and that a rerun replaces rather than refuses.

let song: string;
let binDir: string;
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

const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
// The fake `whisper` is a shell script, so the spawn tests run where shell scripts spawn.
const CAN_SPAWN = HAS_FFMPEG && process.platform !== "win32";

const makeVideo = (at: string): void => {
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=1:size=128x72:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-shortest",
      at,
    ],
    { stdio: "ignore" },
  );
  if (r.status !== 0) throw new Error("the test video could not be made");
};

// A refusal only asks that the video exist, so it stages a placeholder: CI has no ffmpeg.
const stage = (real = true): void => {
  writeLane(song, "cam", "picture-track", {
    events: [{ ref: "intro", start: 2, length: 0, from: 0.5 }],
  });
  writeDoc(join(song, "clips", "intro.k7x"), { source: "clips/intro.mp4" });
  const video = join(song, "clips", "intro.mp4");
  if (real) makeVideo(video);
  else writeFileSync(video, "");
};

// The plugin's verb exists only once its plugin is installed — the same act the
// file-service boot performs, so the tests exercise the real path rather than a static map.
installServerSide(transcriptionPlugin);

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  song = mkdtempSync(join(tmpdir(), "td-transcribe-"));
  binDir = mkdtempSync(join(tmpdir(), "td-transcribe-bin-"));
  // The fake `whisper`: whatever it is handed, it writes the fixture SRT into --output_dir.
  writeFileSync(
    join(binDir, "whisper"),
    [
      "#!/bin/sh",
      'out=""',
      'prev=""',
      'for a in "$@"; do [ "$prev" = "--output_dir" ] && out="$a"; prev="$a"; done',
      'printf \'%s\\n\' "1" "00:00:00,000 --> 00:00:00,900" "hello from the fake whisper" > "$out/audio.srt"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
});
afterEach(() => {
  rmSync(song, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

describe("track transcribe", () => {
  it("refuses a video a clip names outside the project", async () => {
    writeLane(song, "cam", "picture-track", {
      events: [{ ref: "intro", start: 0, length: 0 }],
    });
    writeDoc(join(song, "clips", "intro.k7x"), {
      source: "../../elsewhere/intro.mp4",
    });
    await runCommand("track transcribe cam lyrics", host(), "cli");
    expect(refusals.join("\n")).toMatch(/outside the project/);
  });

  it.runIf(CAN_SPAWN)(
    "writes subtitles placed on a new picture lane where the shot is",
    async () => {
      stage();
      await runCommand("track transcribe cam lyrics", host(), "cli");
      expect(refusals).toEqual([]);
      const srt = readFileSync(join(song, "clips", "lyrics.srt"), "utf8");
      expect(srt).toContain("hello from the fake whisper");
      expect(srt).toContain("00:00:00,000 --> 00:00:00,900");
      expect(wsData(join(song, "clips", "lyrics.k7x")).source).toBe(
        "clips/lyrics.srt",
      );
      expect(pictureLaneIds(song)).toContain("lyrics");
      const lane = pictureLaneFile(song, "lyrics");
      expect(listVideoPlacements(wsText(String(lane?.path)))).toMatchObject([
        { ref: "lyrics", start: 2, length: 0, sourceFrom: 0.5 },
      ]);
    },
  );

  it.runIf(CAN_SPAWN)(
    "replaces its own placement on a rerun, keeping the lane's others",
    async () => {
      stage();
      await runCommand("track transcribe cam lyrics", host(), "cli");
      const lane = String(pictureLaneFile(song, "lyrics")?.path);
      writeLane(song, "lyrics", "picture-track", {
        events: [
          { ref: "lyrics", start: 9, length: 1 },
          { ref: "credits", start: 20, length: 3 },
        ],
      });
      await runCommand("track transcribe cam lyrics", host(), "cli");
      expect(refusals).toEqual([]);
      expect(listVideoPlacements(wsText(lane)).map((p) => p.ref)).toEqual([
        "credits",
        "lyrics",
      ]);
      expect(logs.join(" ")).toMatch(/already existed/);
    },
  );

  it("refuses a sound lane, or a clip of that name that is no subtitle file", async () => {
    stage(false);
    writeLane(song, "notes", "track", { events: [] });
    await runCommand("track transcribe cam notes", host(), "cli");
    expect(refusals.join(" ")).toMatch(/'notes' is a sound lane/);
    writeDoc(join(song, "clips", "intro2.k7x"), { source: "clips/intro.mp4" });
    await runCommand("track transcribe cam intro2", host(), "cli");
    expect(refusals.join(" ")).toMatch(/not a subtitle file/);
    expect(existsSync(join(song, "clips", "intro2.srt"))).toBe(false);
  });

  it("refuses a lane that is not there, or one placing nothing", async () => {
    await runCommand("track transcribe nope lyrics", host(), "cli");
    expect(refusals.join(" ")).toMatch(/no picture lane "nope"/);
    // An ACTIVATION: no ref, no video.
    writeLane(song, "cam", "picture-track", {
      events: [{ start: 0, length: 4 }],
    });
    await runCommand("track transcribe cam lyrics", host(), "cli");
    expect(refusals.join(" ")).toMatch(/places no shot/);
  });

  it("refuses a clip with no video on disk before whisper runs", async () => {
    writeLane(song, "cam", "picture-track", {
      events: [{ ref: "intro", start: 0, length: 0 }],
    });
    writeDoc(join(song, "clips", "intro.k7x"), { source: "clips/intro.mp4" });
    await runCommand("track transcribe cam lyrics", host(), "cli");
    expect(refusals.join(" ")).toMatch(/not on this machine/);
    expect(existsSync(join(song, "nodes", "lyrics.k7x"))).toBe(false);
  });
});
