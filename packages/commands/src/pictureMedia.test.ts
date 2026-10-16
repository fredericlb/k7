// `picture prepare` against real files where ffmpeg is installed: a ProRes shot gets an optimized
// copy named on its clip, a rerun does nothing, and a host that runs work in the background gets
// the request back before the copy exists.

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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  mkdirSync(join(song, "video_tracks"), { recursive: true });
  writeFileSync(
    join(song, "video_tracks", "main.yaml"),
    "events:\n  - { ref: pro, start: 0, length: 1 }\n",
  );
  writeFileSync(join(song, "clips", "pro.yaml"), "source: clips/pro.mov\n");
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
const clipFile = () => readFileSync(join(song, "clips", "pro.yaml"), "utf8");

describe.skipIf(!hasFfmpeg)("picture prepare", () => {
  it("makes an optimized copy of a codec no browser decodes, and names it on the clip", async () => {
    prores();
    await runCommand("picture prepare main", host(), "cli");
    expect(refusals).toEqual([]);
    expect(clipFile()).toContain("optimized: clips/pro.optimized.mp4");
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
    expect(clipFile()).toContain("optimized: clips/pro.optimized.mp4");
  });
});
