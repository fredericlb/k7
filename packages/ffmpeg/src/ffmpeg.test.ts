// ffmpeg.test.ts — bin resolution, the whitelisted input, and run()'s three outcomes, with node standing in for ffmpeg.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asFileInput,
  ffmpegBin,
  ffprobeBin,
  input,
  NoFfmpegError,
  PROTOCOLS,
  run,
  spawnError,
} from "./ffmpeg.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the binaries", () => {
  it("are ffmpeg and ffprobe on the PATH by default", () => {
    vi.stubEnv("FFMPEG_BIN", "");
    vi.stubEnv("FFPROBE_BIN", "");
    expect(ffmpegBin()).toBe("ffmpeg");
    expect(ffprobeBin()).toBe("ffprobe");
  });

  it("follow FFMPEG_BIN and FFPROBE_BIN, read at each call", () => {
    vi.stubEnv("FFMPEG_BIN", "/opt/ff/ffmpeg");
    vi.stubEnv("FFPROBE_BIN", "/opt/ff/ffprobe");
    expect(ffmpegBin()).toBe("/opt/ff/ffmpeg");
    expect(ffprobeBin()).toBe("/opt/ff/ffprobe");
  });
});

describe("input", () => {
  it("puts the whitelist right before its -i", () => {
    expect(PROTOCOLS).toEqual(["-protocol_whitelist", "file,pipe"]);
    expect(input("/a b.wav")).toEqual([
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      "file:/a b.wav",
    ]);
  });

  it("names a path as a file so a colon is not a protocol, and leaves pipes alone", () => {
    expect(asFileInput("/x/Song: Remix.mp3")).toBe("file:/x/Song: Remix.mp3");
    expect(asFileInput("C:\\x\\a.wav")).toBe("file:C:\\x\\a.wav");
    expect(asFileInput("file:/a.wav")).toBe("file:/a.wav");
    expect(asFileInput("-")).toBe("-");
    expect(asFileInput("pipe:0")).toBe("pipe:0");
  });
});

describe("run", () => {
  it("resolves stdout on exit 0", async () => {
    await expect(
      run(process.execPath, ["-e", 'process.stdout.write("hi")']),
    ).resolves.toBe("hi");
  });

  it("reports the stderr tail on a failure, under its name", async () => {
    await expect(
      run(
        process.execPath,
        ["-e", 'process.stderr.write("boom"); process.exit(3)'],
        { what: "bad" },
      ),
    ).rejects.toThrow("bad failed: boom");
  });

  it("turns a missing binary into NoFfmpegError, with its why", async () => {
    const e = await run("/nonexistent/definitely-not-ffmpeg", [], {
      why: "a test needs it",
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NoFfmpegError);
    expect((e as NoFfmpegError).bin).toBe("/nonexistent/definitely-not-ffmpeg");
    expect((e as Error).message).toContain("a test needs it");
  });

  it("kills a child past its deadline", async () => {
    await expect(
      run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        timeoutMs: 200,
        what: "stuck",
      }),
    ).rejects.toThrow(/stuck took longer than .* and was killed/);
  });
});

describe("spawnError", () => {
  it("maps ENOENT only", () => {
    const enoent = Object.assign(new Error("x"), { code: "ENOENT" });
    const eacces = Object.assign(new Error("y"), { code: "EACCES" });
    expect(spawnError(enoent, "ffmpeg")).toBeInstanceOf(NoFfmpegError);
    expect(spawnError(eacces, "ffmpeg")).toBe(eacces);
  });
});
