// A clip's own file, addressed by the PLACEMENT id a surface holds — see docs/projectEdit.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
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
    join(dir, "clips", "bass_2_0.k7x"),
    'source("bass.wav")\n',
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("clipFilePath", () => {
  it("finds the file behind a PLACEMENT id — the bug, pinned", () => {
    expect(clipFilePath(dir, "bass_2_0@16")).toBe(
      join(dir, "clips", "bass_2_0.k7x"),
    );
  });

  it("takes a fractional start, which a placement off the grid has", () => {
    expect(clipFilePath(dir, "bass_2_0@98.5")).toBe(
      join(dir, "clips", "bass_2_0.k7x"),
    );
  });

  it("still takes a bare material name, which is what the CLI is typed with", () => {
    expect(clipFilePath(dir, "bass_2_0")).toBe(
      join(dir, "clips", "bass_2_0.k7x"),
    );
  });

  it("names the FILE it looked for, not only the id it was given", () => {
    // Naming the id alone is useless here: for a placement, it is the one string that is not a filename.
    expect(() => clipFilePath(dir, "nope@16")).toThrow(
      /clips\/nope\.k7x does not exist/,
    );
  });
});

describe("the verbs that reach a clip's file", () => {
  it("writes a stretch map through a placement id", () => {
    setClipWarp(dir, "bass_2_0@16", [
      [0, 0],
      [4, 2],
    ]);
    const clip = parse(
      readFileSync(join(dir, "clips", "bass_2_0.k7x"), "utf8"),
    );
    expect(clip.warp).toEqual({
      algorithm: "elastique",
      markers: [
        [0, 0],
        [4, 2],
      ],
    });
  });

  it("reads and writes onset corrections through one too", () => {
    setClipOnsets(dir, "bass_2_0@16", { added: [1.5] });
    // Read back under the OTHER spelling: both names have to reach one file.
    expect(clipOnsets(dir, "bass_2_0").added).toEqual([1.5]);
  });
});
