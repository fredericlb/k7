import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeLibrary } from "@studio/mediatek/testLibrary";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("@studio/audio-analysis/analyse", async () => {
  const { TooLongError } = await import("@studio/audio-analysis/decode");
  return {
    freshSidecar: () => null,
    analyseFile: (source: string) => {
      calls.push(source);
      return Promise.reject(new TooLongError(source, 1e12, 1));
    },
  };
});

// The pool would run the REAL analysis on a worker thread, out of the mock's reach: here it is the mocked call.
vi.mock("@studio/audio-analysis/pool", async () => ({
  analyseOffThread: (await import("@studio/audio-analysis/analyse"))
    .analyseFile,
}));

const { analyseShared, MarkedFailedError } = await import("./analysisGate.ts");
const { markedFailed, markRunning } = await import("./analysisMarks.ts");

let root: string;
let song: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "analysis-marks-"));
  process.env.STUDIO_MEDIATEK = root;
  song = join(root, "bomb.flac");
  writeFileSync(song, "crafted");
  calls.length = 0;
});

afterEach(async () => {
  await removeLibrary(root);
  delete process.env.STUDIO_MEDIATEK;
});

describe("decode failures on the volume", () => {
  it("marks a file the decode refused, and never decodes it again", async () => {
    await expect(analyseShared(song)).rejects.toThrow(/too long/);
    expect(markedFailed(song)).toMatch(/too long/);
    // The mark is on disk, so a fresh process would read it the same way.
    await expect(analyseShared(song)).rejects.toThrow(MarkedFailedError);
    expect(calls).toEqual([song]);
  });

  it("refuses a file a decode was still running on when the process died", () => {
    markRunning(song);
    expect(markedFailed(song)).toMatch(/stopped while decoding/);
  });

  it("reads the marks again once the file changed under it", () => {
    markRunning(song);
    expect(markedFailed(song)).not.toBeNull();
    rmSync(join(root, ".analysis", "marks.json"));
    expect(markedFailed(song)).toBeNull();
  });

  it("tries the file again once its bytes changed", async () => {
    await expect(analyseShared(song)).rejects.toThrow();
    writeFileSync(song, "a different file");
    expect(markedFailed(song)).toBeNull();
  });
});
