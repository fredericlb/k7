// Inserting and deleting song time — the ROUND TRIP and an INVENTORY of every positioned thing.

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
import { spliceProjectTime } from "./insertTime";

let dir: string;
const BAR = 4; // beats, at 4/4

/** Everything a project can position in time, one of each. */
const FILES: Record<string, string> = {
  "project.yaml": `project:
  name: t
  tempo: 120
  timeSignature: "4/4"
markers:
  "1:1:1": start
  "5:1:1": chorus
`,
  // A lane with what it plays and an alternative's own list.
  "nodes/gtr.yaml": `extends: "@studio/track"
events:
  - { ref: riff, start: "1:1:1" }
  - { ref: riff, start: "5:1:1", fadeIn: "0:1" }
alternatives:
  - name: b
    events:
      - { ref: riff, start: "5:1:1" }
`,
  // A drawn curve: absolute song timecodes.
  "curves/sweep.yaml": `type: custom
points:
  - { time: "1:1:1", value: 0 }
  - { time: "5:1:1", value: 1 }
`,
  // …and one that is NOT positioned, which must come through untouched.
  "curves/wobble.yaml": `type: lfo
shape: sine
frequency: 1
`,
  // Picture, in decimal seconds. At 120bpm one bar is 2s, so 8s is bar 5.
  "video_tracks/cam.yaml": `events:
  - { ref: shot, start: 0, length: 4 }
  - { ref: shot, start: 8, length: 4 }
`,
};

const write = (rel: string, body: string) => {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
};
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
const snapshot = () =>
  Object.fromEntries(Object.keys(FILES).map((f) => [f, read(f)]));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-splice-"));
  for (const [rel, body] of Object.entries(FILES)) write(rel, body);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("inserting time", () => {
  it("moves EVERYTHING positioned in song time, in one pass", () => {
    const r = spliceProjectTime(dir, BAR, BAR, "insert"); // one bar, at bar 2
    const lane = read("nodes/gtr.yaml");
    // Canonical short form: `beatsToPosition` drops a trailing zero tick, so bar 6 is "6:1".
    expect(lane).toContain('start: "1:1:1"'); // before the point: stays, verbatim
    expect(lane.match(/start: "6:1"/g)).toHaveLength(2); // playing, alternative
    // A marker.
    expect(read("project.yaml")).toContain("6:1");
    // A drawn curve's point.
    expect(read("curves/sweep.yaml")).toContain('time: "6:1"');
    // And picture, in seconds: one bar at 120bpm is 2s, so 8 becomes 10.
    expect(read("video_tracks/cam.yaml")).toContain("start: 10");
    expect(r.files.length).toBeGreaterThan(3);
  });

  it("leaves alone everything that is NOT a position", () => {
    spliceProjectTime(dir, BAR, BAR, "insert");
    // A fade is a DURATION spelled as a timecode — the easiest field to shift by mistake.
    expect(read("nodes/gtr.yaml")).toContain('fadeIn: "0:1"');
    // A video placement's `length` is a duration too, and its `start` before the point holds.
    expect(read("video_tracks/cam.yaml")).toContain("length: 4");
    expect(read("video_tracks/cam.yaml")).toContain("start: 0");
    // An LFO is periodic, not positioned: it comes through byte for byte.
    expect(read("curves/wobble.yaml")).toBe(FILES["curves/wobble.yaml"]);
  });

  it("decides a straddling event by its START, the house rule", () => {
    // The riff at 1:1:1 runs across bar 2 and stays, because its start is before the point.
    spliceProjectTime(dir, BAR, BAR, "insert");
    expect(read("nodes/gtr.yaml")).toContain('start: "1:1:1"');
  });
});

describe("deleting time", () => {
  it("drops what starts inside the span and pulls the rest back", () => {
    spliceProjectTime(dir, BAR, BAR * 4, "delete"); // bars 2..5 inclusive
    const lane = read("nodes/gtr.yaml");
    expect(lane).toContain('start: "1:1:1"'); // before the span: kept
    expect(lane).not.toContain('start: "5:1:1"'); // inside it: gone
    expect(read("project.yaml")).not.toContain("5:1:1"); // …markers too
    expect(read("curves/sweep.yaml")).not.toContain('time: "5:1:1"');
  });
});

describe("the round trip", () => {
  /** One splice first, to settle the SPELLING — the round trip is asserted from THERE. */
  const settled = () => {
    spliceProjectTime(dir, BAR, BAR, "insert");
    spliceProjectTime(dir, BAR, BAR, "delete");
    return snapshot();
  };

  it("insert then delete of the same span returns the project byte for byte", () => {
    // The assertion the whole feature rests on: a shift that is not exactly reversible shows here.
    const before = settled();
    spliceProjectTime(dir, BAR * 2, BAR, "insert");
    expect(snapshot()).not.toEqual(before); // it really did something
    spliceProjectTime(dir, BAR * 2, BAR, "delete");
    expect(snapshot()).toEqual(before);
  });

  it("round-trips at a point with material exactly on it", () => {
    // Bar 5 holds two of the fixture's placements, so both directions' edges meet real data.
    const before = settled();
    spliceProjectTime(dir, BAR * 4, BAR * 2, "insert");
    spliceProjectTime(dir, BAR * 4, BAR * 2, "delete");
    expect(snapshot()).toEqual(before);
  });

  it("writes marker keys QUOTED — unquoted, `2:1:1` is a YAML 1.1 number", () => {
    // Neither `setFileValue` nor the timecode quoter could see a timecode used as a KEY.
    spliceProjectTime(dir, BAR, BAR, "insert");
    expect(read("project.yaml")).toMatch(/"\d+:\d+(:\d+)?":/);
  });

  it("a length of zero writes nothing at all", () => {
    const before = snapshot();
    const r = spliceProjectTime(dir, BAR, 0, "insert");
    expect(r.files).toEqual([]);
    expect(snapshot()).toEqual(before);
  });
});
