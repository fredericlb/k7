// Recording OVER something. What was on the lane is not stacked under the new take and not thrown
// away: it is set aside as a take, which is the whole of what a loop record does one pass at a
// time. See packages/song/docs/takes.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { loadProject } from "@studio/song/project";
import { takeValues } from "@studio/song/yaml/trackFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTakeToTrack } from "./recordTake";

let dir: string;

/** 44 bytes of WAV header and no samples — enough to BE a file, which is all this asks of it. */
function wav(path: string): void {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(192000, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(0, 40);
  writeFileSync(path, b);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-over-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(join(dir, "chains.yaml"), "modules: {}\n", "utf8");
  mkdirSync(join(dir, "clips"), { recursive: true });
  mkdirSync(join(dir, "nodes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// 120bpm 4/4: a beat is half a second, a bar two seconds. Bar 3 == 4s in.
const doc = () => loadProject(dir) as ProjectDoc;
const take = (start: number, length: number) => {
  const file = join(dir, "clips", "take-tmp.wav");
  wav(file);
  return { track: "gtr", file, start, length };
};
const trackText = () => readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");
const takes = () => takeValues(trackText());
const playing = () =>
  loadProject(dir).tracks.find((t) => t.id === "gtr")?.clips ?? [];

/** A lane already playing `riff` from bar 3, four bars long. */
function laneWithRiff(): void {
  wav(join(dir, "clips", "riff.wav"));
  writeFileSync(
    join(dir, "clips", "riff.yaml"),
    'source: clips/riff.wav\nfrom: "1:1"\nto: "5:1"\n',
    "utf8",
  );
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@studio/audio-track"\nevents:\n  - { ref: riff, start: "3:1" }\n',
    "utf8",
  );
}

/** …and an empty one. */
function bareLane(): void {
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@studio/audio-track"\n',
    "utf8",
  );
}

describe("recording over what a lane is playing", () => {
  it("sets the old events aside as a take, and plays only the new one", () => {
    laneWithRiff();
    const id = addTakeToTrack(dir, doc(), take(4, 8)); // bar 3, four bars — right on top
    expect(takes()).toHaveLength(1);
    expect(takes()[0].events).toEqual([{ ref: "riff", start: "3:1" }]);
    const now = playing();
    expect(now).toHaveLength(1);
    expect(now[0].id).toBe(id);
  });

  it("leaves an event alone when the take lands somewhere else", () => {
    laneWithRiff();
    addTakeToTrack(dir, doc(), take(12, 4)); // bar 7 onward — after the riff ends
    expect(takes()).toHaveLength(0);
    expect(playing()).toHaveLength(2);
  });

  it("does NOT count two events that merely touch, end to start", () => {
    // The riff runs bars 3–7. A take starting exactly at bar 7 follows it; it is not over it.
    laneWithRiff();
    addTakeToTrack(dir, doc(), take(12, 8));
    expect(takes()).toHaveLength(0);
  });

  it("makes no take of an empty lane — there was nothing to record over", () => {
    bareLane();
    addTakeToTrack(dir, doc(), take(4, 8));
    expect(takes()).toHaveLength(0);
    expect(playing()).toHaveLength(1);
  });
});

describe("recording round a loop", () => {
  it("makes ONE take per pass, each holding the pass before it", () => {
    // Every pass records the same bars, so from the second one there is always something under it.
    // The caller recompiles between takes, which is what this loop stands in for.
    bareLane();
    const ids = [
      addTakeToTrack(dir, doc(), take(4, 8)),
      addTakeToTrack(dir, doc(), take(4, 8)),
      addTakeToTrack(dir, doc(), take(4, 8)),
    ];
    expect(takes()).toHaveLength(2);
    // Oldest first: take 1 is pass 1, take 2 is pass 2, and the lane plays pass 3.
    expect(takes()[0].events).toEqual([{ ref: ids[0], start: "3:1" }]);
    expect(takes()[1].events).toEqual([{ ref: ids[1], start: "3:1" }]);
    const now = playing();
    expect(now).toHaveLength(1);
    expect(now[0].id).toBe(ids[2]);
  });
});

describe("recording over an alternative", () => {
  it("puts the RUNNING set's events aside, not the module's", () => {
    wav(join(dir, "clips", "riff.wav"));
    writeFileSync(
      join(dir, "clips", "riff.yaml"),
      'source: clips/riff.wav\nfrom: "1:1"\nto: "5:1"\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "nodes", "gtr.yaml"),
      [
        'extends: "@studio/audio-track"',
        "events:",
        '  - { ref: riff, start: "3:1" }',
        "alternative: loud",
        "alternatives:",
        "  - name: loud",
        "    events:",
        '      - { ref: riff, start: "3:1" }',
        "",
      ].join("\n"),
      "utf8",
    );
    addTakeToTrack(dir, doc(), take(4, 8));
    const text = trackText();
    // The take is the alternative's, and the module's own clips are untouched.
    expect(takeValues(text)).toHaveLength(1);
    expect(text).toMatch(/^events:\n {2}- \{ ref: riff, start: "3:1" \}$/m);
  });
});
