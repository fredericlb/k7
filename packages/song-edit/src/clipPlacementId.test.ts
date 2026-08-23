// A clip's own file, addressed by the id a SURFACE holds.
//
// Every surface that draws a clip holds a PLACEMENT id — `bass_2_0@16`, what the compiler put on
// it and what `/waveform` is asked with — while `clips/<ref>.yaml` is keyed by the material. The
// two were never joined on this side, so `clip warp` and `clip onset …` were reachable only by
// typing a material name by hand: from the waveform they raised
// `no clip "sy.chrpan2_260821T105129@106" in this project`, which is the file-service half of the
// rule (waveformOps.ts, workspace.ts) missing from the song half.
//
// Pinned on the FILE functions rather than through a command, because that is where the join now
// is and where a later reader will look for it.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clipFilePath,
  clipOnsets,
  setClipOnsets,
  setClipWarp,
} from "./projectEdit";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-clipid-"));
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(
    join(dir, "clips", "bass_2_0.yaml"),
    "source: bass.wav\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("clipFilePath", () => {
  it("finds the file behind a PLACEMENT id — the bug, pinned", () => {
    expect(clipFilePath(dir, "bass_2_0@16")).toBe(
      join(dir, "clips", "bass_2_0.yaml"),
    );
  });

  it("takes a fractional start, which a placement off the grid has", () => {
    expect(clipFilePath(dir, "bass_2_0@98.5")).toBe(
      join(dir, "clips", "bass_2_0.yaml"),
    );
  });

  it("still takes a bare material name, which is what the CLI is typed with", () => {
    expect(clipFilePath(dir, "bass_2_0")).toBe(
      join(dir, "clips", "bass_2_0.yaml"),
    );
  });

  it("names the FILE it looked for, not only the id it was given", () => {
    // The old line named the id alone — for a placement, the one string that is not a filename.
    expect(() => clipFilePath(dir, "nope@16")).toThrow(
      /clips\/nope\.yaml does not exist/,
    );
  });
});

describe("the verbs that reach a clip's file", () => {
  it("writes a stretch map through a placement id", () => {
    setClipWarp(dir, "bass_2_0@16", [
      [0, 0],
      [4, 2],
    ]);
    expect(readFileSync(join(dir, "clips", "bass_2_0.yaml"), "utf8")).toMatch(
      /warp:/,
    );
  });

  it("reads and writes onset corrections through one too", () => {
    setClipOnsets(dir, "bass_2_0@16", { added: [1.5] });
    // Read back under the OTHER spelling: both names have to reach one file, or a correction
    // written from the waveform would be invisible to the same clip opened whole.
    expect(clipOnsets(dir, "bass_2_0").added).toEqual([1.5]);
  });
});
