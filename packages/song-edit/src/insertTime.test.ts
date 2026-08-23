// Inserting and deleting song time — `project add` / `project remove`.
//
// The load-bearing test in the file is the ROUND TRIP: insert a bar, delete it again, and the
// project has to be byte-for-byte what it was. It catches in one assertion everything a
// per-field test would need a case each for — a shift applied twice, a spelling that drifts
// (position vs duration), a key that gains quotes on the way out, and a kind of thing that moves
// one way and not back.
//
// The other half is the INVENTORY: a fixture holding one of every positioned thing, so that a
// field added to the model later and forgotten here shows up as a thing that did not move.

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
  // A lane with all three lists a lane can hold: what it plays, a take of it, and an
  // alternative with its own two.
  "nodes/gtr.yaml": `extends: "@studio/track"
events:
  - { ref: riff, start: "1:1:1" }
  - { ref: riff, start: "5:1:1", fadeIn: "0:1" }
takes:
  - events:
      - { ref: riff, start: "5:1:1" }
alternatives:
  - name: b
    events:
      - { ref: riff, start: "5:1:1" }
    takes:
      - events:
          - { ref: riff, start: "9:1:1" }
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
  "video_tracks/cam.yaml": `kind: video
events:
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
    // The lane's three lists, all of them.
    const lane = read("nodes/gtr.yaml");
    // Written in the canonical short form — `beatsToPosition` drops a trailing zero tick, so a
    // bar-6 downbeat is "6:1". The untouched one keeps the spelling the fixture wrote.
    expect(lane).toContain('start: "1:1:1"'); // before the point: stays, verbatim
    expect(lane.match(/start: "6:1"/g)).toHaveLength(3); // playing, take, alternative
    expect(lane).toContain('start: "10:1"'); // the alternative's own take
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
    // A fade is a DURATION that happens to be spelled as a timecode — the single easiest field
    // in the model to shift by mistake.
    expect(read("nodes/gtr.yaml")).toContain('fadeIn: "0:1"');
    // A video placement's `length` is a duration too, and its `start` before the point holds.
    expect(read("video_tracks/cam.yaml")).toContain("length: 4");
    expect(read("video_tracks/cam.yaml")).toContain("start: 0");
    // An LFO is periodic, not positioned: it comes through byte for byte.
    expect(read("curves/wobble.yaml")).toBe(FILES["curves/wobble.yaml"]);
  });

  it("decides a straddling event by its START, the house rule", () => {
    // The riff at 1:1:1 runs across bar 2 — and stays, because its start is before the point.
    // Cutting it instead would make inserting time a verb that writes material and renders audio.
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
  /**
   * One splice first, to settle the SPELLING.
   *
   * `beatsToPosition` writes the canonical short form, so a hand-written `"5:1:1"` comes back as
   * `"5:1"` — the same beat, spelled the way every writer in the repo spells it. That is a
   * normalisation, not a drift, and it happens once: the fixture below is what a project looks
   * like after anything has touched it.
   *
   * Which is why the round trip is asserted from THERE. Demanding byte-equality against
   * hand-written text would be asserting that the writers preserve input spelling, which they do
   * not and should not; demanding it against written text asserts what actually matters — that
   * the shift is exactly reversible.
   */
  const settled = () => {
    spliceProjectTime(dir, BAR, BAR, "insert");
    spliceProjectTime(dir, BAR, BAR, "delete");
    return snapshot();
  };

  it("insert then delete of the same span returns the project byte for byte", () => {
    // The assertion the whole feature rests on. A shift that is not exactly reversible — a
    // duration written where a position belongs, a value that gains or loses quotes, a rounding
    // that accumulates — shows up here and nowhere else.
    const before = settled();
    spliceProjectTime(dir, BAR * 2, BAR, "insert");
    expect(snapshot()).not.toEqual(before); // it really did something
    spliceProjectTime(dir, BAR * 2, BAR, "delete");
    expect(snapshot()).toEqual(before);
  });

  it("round-trips at a point with material exactly on it", () => {
    // Bar 5 is where three of the fixture's placements sit, so the inclusive/exclusive edges of
    // both directions meet on real data rather than in a gap.
    const before = settled();
    spliceProjectTime(dir, BAR * 4, BAR * 2, "insert");
    spliceProjectTime(dir, BAR * 4, BAR * 2, "delete");
    expect(snapshot()).toEqual(before);
  });

  it("writes marker keys QUOTED — unquoted, `2:1:1` is a YAML 1.1 number", () => {
    // The trap `writeMarkers` has carried a comment about since it was written, and did not
    // implement: `setFileValue` gives every key the plain style, and the timecode quoter walks
    // VALUES under known keys, so neither could see a timecode used as a KEY.
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
