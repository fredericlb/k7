// Where a take lands when the lane is running one of its OTHER sets of attributes.
//
// A lane's alternatives each restate `events:`, and a list is a scalar to the merge — so the running
// set REPLACES the arrangement rather than adding to it (packages/song/docs/alternatives.md). A take
// appended to the file's top-level `events:` while another set is running is therefore written to a
// set nobody is playing: on disk, and silent. This is the shape of `nodes/ge.rythm.yaml` in a real
// project, which is where it was found.

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

/** A lane, optionally running one of its alternatives. */
function lane(body: string): void {
  writeFileSync(join(dir, "nodes", "gtr.yaml"), body, "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-alt-"));
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

const doc = () => loadProject(dir) as ProjectDoc;
const take = () => {
  const file = join(dir, "clips", "take-tmp.wav");
  wav(file);
  return { track: "gtr", file, start: 4, length: 8 }; // bar 3 at 120bpm 4/4
};
const played = (): string[] =>
  loadProject(dir)
    .tracks.find((t) => t.id === "gtr")
    ?.clips.map((c) => c.id) ?? [];

describe("a take recorded on a lane running its FIRST set", () => {
  it("lands where it is played — the case that always worked", () => {
    lane('extends: "@studio/audio-track"\n');
    const id = addTakeToTrack(dir, doc(), take());
    expect(played()).toContain(id);
  });
});

describe("a take recorded while an ALTERNATIVE is running", () => {
  it("lands on the set the lane is actually playing", () => {
    // THE bug: appended to the top-level `events:` instead, the take is on disk, declared, named
    // after the right bar — and absent from the lane, because the running set replaced that list.
    lane(
      'extends: "@studio/audio-track"\nevents: []\nalternatives:\n  - name: b\n    events: []\nalternative: b\n',
    );
    const id = addTakeToTrack(dir, doc(), take());
    expect(played()).toContain(id);
  });

  it("keeps the other sets untouched", () => {
    // An alternative is a take you can go back to. Recording into one must not edit the others.
    lane(
      'extends: "@studio/audio-track"\nevents: [ { ref: first, start: "1:1" } ]\nalternatives:\n  - name: b\n    events: []\nalternative: b\n',
    );
    addTakeToTrack(dir, doc(), take());
    const text = readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");
    expect(text).toContain("ref: first");
    expect(played()).not.toContain("first"); // …and set "b" is still the one playing
  });

  it("still names the take after the bar it was played at", () => {
    lane(
      'extends: "@studio/audio-track"\nalternatives:\n  - name: b\n    events: []\nalternative: b\n',
    );
    const id = addTakeToTrack(dir, doc(), take());
    expect(id).toContain("_3.1_");
  });
});
