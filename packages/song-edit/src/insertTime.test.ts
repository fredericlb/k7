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
import { parse } from "@studio/k7x/document";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spliceProjectTime } from "./insertTime";

let dir: string;
const BAR = 4; // beats, at 4/4

/** Everything a project can position in time, one of each. */
const FILES: Record<string, string> = {
  "project.k7x": `project({ name: "t", tempo: 120, timeSignature: "4/4" })
markers({ "1:1:1": "start", "5:1:1": "chorus" })
`,
  // A lane with what it plays and an alternative's own list.
  "nodes/gtr.k7x": `extends("@meta/track")
events([
  ref("riff").start("1:1:1"),
  ref("riff").start("5:1:1").fadeIn("0:1"),
])
alternatives([name("b").events([ref("riff").start("5:1:1")])])
`,
  // A drawn curve: absolute song timecodes.
  "curves/sweep.k7x": `type("custom")
points([time("1:1:1").value(0), time("5:1:1").value(1)])
`,
  // …and one that is NOT positioned, which must come through untouched.
  "curves/wobble.k7x": `type("lfo")
shape("sine")
frequency(1)
`,
  // Picture, in decimal seconds. At 120bpm one bar is 2s, so 8s is bar 5.
  "video_tracks/cam.k7x": `events([
  ref("shot").start(0).length(4),
  ref("shot").start(8).length(4),
])
`,
};

const write = (rel: string, body: string) => {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
};
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
type Row = Record<string, unknown>;
const data = (rel: string) => parse(read(rel)) as Record<string, Row[] & Row>;
const starts = (rows: Row[] | undefined) => (rows ?? []).map((r) => r.start);
const markers = () => Object.keys(data("project.k7x").markers ?? {});
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
    const lane = data("nodes/gtr.k7x");
    // Canonical short form: `beatsToPosition` drops a trailing zero tick, so bar 6 is "6:1".
    expect(starts(lane.events)).toEqual(["1:1:1", "6:1"]); // before the point: stays, verbatim
    expect(starts(lane.alternatives[0].events as Row[])).toEqual(["6:1"]);
    // A marker.
    expect(markers()).toEqual(["1:1", "6:1"]);
    // A drawn curve's point.
    expect(data("curves/sweep.k7x").points.map((p) => p.time)).toEqual([
      "1:1:1",
      "6:1",
    ]);
    // And picture, in seconds: one bar at 120bpm is 2s, so 8 becomes 10.
    expect(starts(data("video_tracks/cam.k7x").events)).toEqual([0, 10]);
    expect(r.files).toEqual([
      "nodes/gtr.k7x",
      "curves/sweep.k7x",
      "video_tracks/cam.k7x",
      "project.k7x",
    ]);
  });

  it("leaves alone everything that is NOT a position", () => {
    spliceProjectTime(dir, BAR, BAR, "insert");
    // A fade is a DURATION spelled as a timecode — the easiest field to shift by mistake.
    expect(data("nodes/gtr.k7x").events[1].fadeIn).toBe("0:1");
    // A video placement's `length` is a duration too, and its `start` before the point holds.
    expect(data("video_tracks/cam.k7x").events).toEqual([
      { ref: "shot", start: 0, length: 4 },
      { ref: "shot", start: 10, length: 4 },
    ]);
    // An LFO is periodic, not positioned: it comes through byte for byte.
    expect(read("curves/wobble.k7x")).toBe(FILES["curves/wobble.k7x"]);
  });

  it("decides a straddling event by its START, the house rule", () => {
    // The riff at 1:1:1 runs across bar 2 and stays, because its start is before the point.
    spliceProjectTime(dir, BAR, BAR, "insert");
    expect(starts(data("nodes/gtr.k7x").events)[0]).toBe("1:1:1");
  });
});

describe("deleting time", () => {
  it("drops what starts inside the span and pulls the rest back", () => {
    spliceProjectTime(dir, BAR, BAR * 4, "delete"); // bars 2..5 inclusive
    // Before the span: kept; inside it: gone.
    expect(starts(data("nodes/gtr.k7x").events)).toEqual(["1:1:1"]);
    expect(markers()).toEqual(["1:1"]); // …markers too, rewritten whole
    expect(data("curves/sweep.k7x").points.map((p) => p.time)).toEqual([
      "1:1:1",
    ]);
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

  it("a length of zero writes nothing at all", () => {
    const before = snapshot();
    const r = spliceProjectTime(dir, BAR, 0, "insert");
    expect(r.files).toEqual([]);
    expect(snapshot()).toEqual(before);
  });
});

describe("a splice that fails partway", () => {
  it("writes nothing: the lanes before the broken file are not left shifted", () => {
    // A lane is transformed before the video, so a throw on the video would otherwise leave it moved alone.
    write("video_tracks/cam.k7x", 'events([ref("shot").start(8)\n');
    const before = snapshot();
    expect(() => spliceProjectTime(dir, BAR, BAR, "insert")).toThrow();
    expect(snapshot()).toEqual(before);
  });
});
