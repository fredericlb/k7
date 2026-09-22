import { spawnSync } from "node:child_process";
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
import { runCommand } from "@studio/commands/commandSpec";
import { loadModules } from "@studio/song/loader";
import { installServerSide } from "@studio/st0-sdk/install";
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

const stage = (): void => {
  mkdirSync(join(song, "video_tracks"), { recursive: true });
  mkdirSync(join(song, "clips"), { recursive: true });
  writeFileSync(
    join(song, "video_tracks", "cam.yaml"),
    "# the camera\nevents:\n  - { ref: intro, start: 0, length: 0 }\n",
    "utf8",
  );
  writeFileSync(
    join(song, "clips", "intro.yaml"),
    "source: clips/intro.mp4\n",
    "utf8",
  );
  makeVideo(join(song, "clips", "intro.mp4"));
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
  it.runIf(CAN_SPAWN)(
    "writes the transcript as the new track's content",
    async () => {
      stage();
      await runCommand("track transcribe cam lyrics", host(), "cli");
      const nodeFile = join(song, "nodes", "lyrics.yaml");
      expect(existsSync(nodeFile)).toBe(true);
      const body = readFileSync(nodeFile, "utf8");
      expect(body).toContain("content:");
      expect(body).toContain("hello from the fake whisper");
      expect(body).toContain("00:00:00,000 --> 00:00:00,900");
      // The lane is a module like any other, so the loader answers its content by bare name.
      expect(loadModules(song).lyrics?.content).toContain(
        "hello from the fake whisper",
      );
      expect(refusals).toEqual([]);
    },
  );

  it.runIf(CAN_SPAWN)(
    "replaces the content of a track that already existed",
    async () => {
      stage();
      mkdirSync(join(song, "nodes"), { recursive: true });
      writeFileSync(
        join(song, "nodes", "lyrics.yaml"),
        'extends: "@meta/doc"\ncontent: |\n  the old note\n',
        "utf8",
      );
      await runCommand("track transcribe cam lyrics", host(), "cli");
      const body = readFileSync(join(song, "nodes", "lyrics.yaml"), "utf8");
      expect(body).toContain("hello from the fake whisper");
      expect(body).not.toContain("the old note");
      expect(logs.join(" ")).toMatch(/already existed/);
    },
  );

  it("refuses a lane that is not there, or one placing nothing", async () => {
    await runCommand("track transcribe nope lyrics", host(), "cli");
    expect(refusals.join(" ")).toMatch(/no picture lane "nope"/);
    mkdirSync(join(song, "video_tracks"), { recursive: true });
    writeFileSync(
      join(song, "video_tracks", "cam.yaml"),
      "events:\n  - { start: 0, length: 4 }\n", // an ACTIVATION: no ref, no video
      "utf8",
    );
    await runCommand("track transcribe cam lyrics", host(), "cli");
    expect(refusals.join(" ")).toMatch(/places no shot/);
  });

  it("refuses a clip with no video on disk before whisper runs", async () => {
    mkdirSync(join(song, "video_tracks"), { recursive: true });
    mkdirSync(join(song, "clips"), { recursive: true });
    writeFileSync(
      join(song, "video_tracks", "cam.yaml"),
      "events:\n  - { ref: intro, start: 0, length: 0 }\n",
      "utf8",
    );
    writeFileSync(
      join(song, "clips", "intro.yaml"),
      "source: clips/intro.mp4\n",
    );
    await runCommand("track transcribe cam lyrics", host(), "cli");
    expect(refusals.join(" ")).toMatch(/not on this machine/);
    expect(existsSync(join(song, "nodes", "lyrics.yaml"))).toBe(false);
  });
});
