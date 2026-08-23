// `curve point add|move|remove` — the shape of a drawn curve, point by point.
//
// Two invariants carry this family, and both are properties of the FILE rather than of any one
// call, so they are asserted on the text: the points stay in TIME ORDER (the bake sorts anyway;
// the file is the thing a person reads by eye), and a custom curve never runs out of points (one
// with none does not load, and a curve file the loader refuses takes the whole project with it).

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
import { runCommand } from "./commandSpec";

let dir: string;

const CURVE = `type: custom
polarity: unipolar
points:
  - { time: "1:1:1", value: 0 }
  - { time: "5:1:1", value: 1 }
`;

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-curvept-"));
  writeFileSync(
    join(d, "project.yaml"),
    'project:\n  name: t\n  tempo: 120\n  timeSignature: "4/4"\n',
    "utf8",
  );
  mkdirSync(join(d, "curves"), { recursive: true });
  writeFileSync(join(d, "curves", "sweep.yaml"), CURVE, "utf8");
  // An LFO, to prove the family refuses a curve that has no points to edit.
  writeFileSync(
    join(d, "curves", "wobble.yaml"),
    "type: lfo\nshape: sine\nfrequency: 1\n",
    "utf8",
  );
  return d;
}

const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ timeSigNumerator: 4, timeSigDenominator: 4, tracks: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
    showNativePluginUI: () => {},
  }) as never;

const text = (id = "sweep") =>
  readFileSync(join(dir, "curves", `${id}.yaml`), "utf8");
/** The times, in the order the FILE lists them — which is the invariant worth holding. */
const times = (id = "sweep") =>
  [...text(id).matchAll(/time:\s*"([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  dir = song();
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("curve point add", () => {
  it("inserts IN TIME ORDER, not at the end", async () => {
    // The bake sorts regardless: this is about the FILE staying readable under a drag.
    await runCommand("curve point add sweep 3:1:1 0.5", host(), "cli");
    expect(times()).toEqual(["1:1:1", "3:1", "5:1:1"]);
  });

  it("SETS a point already at that moment rather than growing a twin", async () => {
    // A curve is a function of song time: two values at one moment is not a curve.
    await runCommand("curve point add sweep 5:1:1 0.25", host(), "cli");
    expect(times()).toEqual(["1:1:1", "5:1:1"]);
    expect(text()).toContain("0.25");
    expect(logs.join(" ")).toContain("set the point");
  });

  it("clamps a value outside 0..1 rather than writing it", async () => {
    await runCommand("curve point add sweep 3:1:1 4", host(), "cli");
    expect(text()).toMatch(/time: "3:1", value: 1 \}/);
  });

  it("writes the time QUOTED — unquoted, `3:1` is a YAML 1.1 number", async () => {
    await runCommand("curve point add sweep 3:1:1 0.5", host(), "cli");
    expect(text()).toContain('time: "3:1"');
  });

  it("refuses a curve with no points to edit", async () => {
    await runCommand("curve point add wobble 3:1:1 0.5", host(), "cli");
    expect(logs.join(" ")).toContain("only a `type: custom`");
    expect(text("wobble")).toBe("type: lfo\nshape: sine\nfrequency: 1\n");
  });

  it("refuses a curve that is not there, by name", async () => {
    await runCommand("curve point add nope 3:1:1 0.5", host(), "cli");
    expect(logs.join(" ")).toContain("nope");
  });
});

describe("curve point move", () => {
  it("moves one point and keeps its value", async () => {
    await runCommand("curve point move sweep 5:1:1 7:1:1", host(), "cli");
    expect(times()).toEqual(["1:1:1", "7:1"]);
    expect(text()).toMatch(/time: "7:1", value: 1 \}/);
  });

  it("takes a new value when one is given", async () => {
    await runCommand("curve point move sweep 5:1:1 7:1:1 0.3", host(), "cli");
    expect(text()).toMatch(/time: "7:1", value: 0.3 \}/);
  });

  it("keeps the list sorted when a point moves BACK past another", async () => {
    await runCommand("curve point add sweep 9:1:1 0.5", host(), "cli");
    await runCommand("curve point move sweep 9:1:1 3:1:1", host(), "cli");
    expect(times()).toEqual(["1:1:1", "3:1", "5:1:1"]);
  });

  it("refuses when nothing is at that moment", async () => {
    await runCommand("curve point move sweep 2:1:1 7:1:1", host(), "cli");
    expect(logs.join(" ")).toContain("curve point move");
    expect(times()).toEqual(["1:1:1", "5:1:1"]);
  });
});

describe("curve point remove", () => {
  it("takes one out", async () => {
    await runCommand("curve point remove sweep 5:1:1", host(), "cli");
    expect(times()).toEqual(["1:1:1"]);
  });

  it("refuses the LAST one, and says what to use instead", async () => {
    // A pointless custom curve does not parse, and that takes the whole project with it.
    await runCommand("curve point remove sweep 5:1:1", host(), "cli");
    logs.length = 0;
    await runCommand("curve point remove sweep 1:1:1", host(), "cli");
    expect(logs.join(" ")).toContain("track automation remove");
    expect(times()).toEqual(["1:1:1"]);
  });

  it("refuses a moment with no point on it", async () => {
    await runCommand("curve point remove sweep 2:1:1", host(), "cli");
    expect(times()).toEqual(["1:1:1", "5:1:1"]);
  });
});
