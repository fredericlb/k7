// Putting an existing clip on a lane — what `event add` writes.
//
// A placement is a REFERENCE: the clip is not moved, copied or altered, and the same material may
// sit on two lanes at once. And it lands on the set the lane is PLAYING, like every other placement
// edit — a lane running an alternative would otherwise receive it into a list nobody hears
// (packages/song/docs/alternatives.md).

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
import { addTrackPlacement } from "./trackMix";

let dir: string;

const lane = (body: string) =>
  writeFileSync(join(dir, "nodes", "gtr.yaml"), body, "utf8");
const laneText = () => readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-add-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("putting a clip on a lane", () => {
  it("writes the reference and the position, and nothing else", () => {
    lane('extends: "@studio/audio-track"\n');
    addTrackPlacement(dir, "gtr", "riff", "3:1");
    expect(laneText()).toContain("ref: riff");
    expect(laneText()).toContain('start: "3:1"');
    // No length: how long it sounds is the material's window (see PlacementSchema).
    expect(laneText()).not.toContain("length");
  });

  it("creates the clips list on a lane that had none", () => {
    lane('extends: "@studio/audio-track"\n');
    addTrackPlacement(dir, "gtr", "riff", "1:1");
    expect(laneText()).toContain("events:");
  });

  it("keeps the placements already there", () => {
    lane(
      'extends: "@studio/audio-track"\nevents: [ { ref: first, start: "1:1" } ]\n',
    );
    addTrackPlacement(dir, "gtr", "second", "5:1");
    expect(laneText()).toContain("ref: first");
    expect(laneText()).toContain("ref: second");
  });

  it("lands on the set the lane is PLAYING, not the first one", () => {
    lane(
      'extends: "@studio/audio-track"\nevents: []\nalternatives:\n  - name: b\n    events: []\nalternative: b\n',
    );
    addTrackPlacement(dir, "gtr", "riff", "2:1");
    // The running set gets it; the file's top-level list stays empty.
    const text = laneText();
    const top = text.slice(
      text.indexOf("events:"),
      text.indexOf("alternatives:"),
    );
    expect(top).not.toContain("ref: riff");
    expect(text).toContain("ref: riff");
  });

  it("refuses a lane that has no file, naming what it could not do", () => {
    expect(() => addTrackPlacement(dir, "nosuch", "riff", "1:1")).toThrow(
      /nosuch/,
    );
  });

  it("does not touch the clip itself — a placement is a reference", () => {
    lane('extends: "@studio/audio-track"\n');
    mkdirSync(join(dir, "clips"), { recursive: true });
    const clip = join(dir, "clips", "riff.yaml");
    writeFileSync(clip, "source: clips/riff.wav\n", "utf8");
    addTrackPlacement(dir, "gtr", "riff", "1:1");
    expect(readFileSync(clip, "utf8")).toBe("source: clips/riff.wav\n");
  });
});
