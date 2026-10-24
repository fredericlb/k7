// `picture prepare` against real files where ffmpeg is installed: a ProRes shot gets an optimized
// copy named on its clip, a rerun does nothing, and a host that runs work in the background gets
// the request back before the copy exists. Then the phone: the same files read with no ffmpeg.

import { execFileSync } from "node:child_process";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "./commandSpec";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let song: string;
const logs: string[] = [];
const refusals: string[] = [];
const host = (extra: Record<string, unknown> = {}) =>
  ({
    songPath: song,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
    ...extra,
  }) as never;

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  song = mkdtempSync(join(tmpdir(), "td-pmedia-"));
  mkdirSync(join(song, "clips"), { recursive: true });
  mkdirSync(join(song, "nodes"), { recursive: true });
  writeFileSync(
    join(song, "nodes", "main.k7x"),
    'extends("@meta/picture-track")\nevents([ref("pro").start(0).length(1)])\n',
  );
  writeFileSync(join(song, "clips", "pro.k7x"), 'source("clips/pro.mov")\n');
});
afterEach(() => rmSync(song, { recursive: true, force: true }));

const prores = () =>
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=s=160x120:d=0.5",
    "-c:v",
    "prores_ks",
    join(song, "clips", "pro.mov"),
  ]);
const clipFile = () => readFileSync(join(song, "clips", "pro.k7x"), "utf8");

describe.skipIf(!hasFfmpeg)("picture prepare", () => {
  it("makes an optimized copy of a codec no browser decodes, and names it on the clip", async () => {
    prores();
    await runCommand("picture prepare main", host(), "cli");
    expect(refusals).toEqual([]);
    expect(clipFile()).toContain('optimized("clips/pro.optimized.mp4")');
    expect(existsSync(join(song, "clips", "pro.optimized.mp4"))).toBe(true);
    logs.length = 0;
    await runCommand("picture prepare main", host(), "cli");
    expect(logs).toContain("pro: already prepared");
  });

  it("hands the copy to the host's background runner, and returns first", async () => {
    prores();
    const jobs: (() => Promise<string>)[] = [];
    await runCommand(
      "picture prepare main",
      host({
        background: (_tag: string, work: () => Promise<string>) => {
          jobs.push(work);
          return true;
        },
      }),
      "cli",
    );
    expect(jobs).toHaveLength(1);
    expect(clipFile()).not.toContain("optimized");
    expect(await jobs[0]?.()).toMatch(/prepared \(optimized\)/);
    expect(clipFile()).toContain('optimized("clips/pro.optimized.mp4")');
  });
});

describe.skipIf(!hasFfmpeg)(
  "picture prepare without ffmpeg, as on the phone",
  () => {
    /** A shot `pro` whose source is `name`, encoded from a test picture by `args` while ffmpeg is still here. */
    const shot = (name: string, size: string, args: string[]) => {
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc=s=${size}:d=0.5`,
        ...args,
        join(song, "clips", name),
      ]);
      writeFileSync(
        join(song, "clips", "pro.k7x"),
        `source("clips/${name}")\n`,
      );
      vi.stubEnv("FFMPEG_BIN", join(song, "no-ffmpeg"));
      vi.stubEnv("FFPROBE_BIN", join(song, "no-ffprobe"));
    };
    const platform = process.platform;
    afterEach(() => {
      vi.unstubAllEnvs();
      Object.defineProperty(process, "platform", { value: platform });
    });

    it("says which clip needs a copy it cannot make, and what it is", async () => {
      shot("pro.mov", "160x120", ["-c:v", "prores_ks"]);
      await runCommand("picture prepare main", host(), "cli");
      expect(logs[0]).toMatch(/^pro: prores in yuv4\d\dp10le, 160×120$/);
      expect(logs.at(-1)).toMatch(/^pro: this video may not play/);
      expect(clipFile()).not.toContain("optimized");
    });

    it("previews a tall source as it is rather than asking for a proxy", async () => {
      shot("tall.mp4", "64x1200", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]);
      await runCommand("picture prepare main", host(), "cli");
      expect(logs).toEqual([
        "pro: previewed from its source — no ffmpeg here for a proxy",
      ]);
    });

    it("plays a phone's HEVC as it is on Android", async () => {
      shot("phone.mp4", "160x120", [
        "-c:v",
        "libx265",
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
      ]);
      Object.defineProperty(process, "platform", { value: "android" });
      await runCommand("picture prepare main", host(), "cli");
      expect(logs).toEqual(["pro: ready as it is"]);
    });
  },
);
