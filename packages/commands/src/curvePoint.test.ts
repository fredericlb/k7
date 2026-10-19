// `curve point add|move|remove` — the shape of a drawn curve, point by point.
//
// Two invariants carry this family, and both are properties of the FILE rather than of any one
// call, so they are asserted on what it holds: the points stay in TIME ORDER (the bake sorts
// anyway; the file is the thing a person reads by eye), and a custom curve never runs out of points
// (one with none does not load, and a curve file the loader refuses takes the whole project with it).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-curvept-"));
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, timeSignature: "4/4" },
  });
  writeDoc(join(d, "curves", "sweep.k7x"), {
    type: "custom",
    polarity: "unipolar",
    points: [
      { time: "1:1:1", value: 0 },
      { time: "5:1:1", value: 1 },
    ],
  });
  // An LFO, to prove the family refuses a curve that has no points to edit.
  writeDoc(join(d, "curves", "wobble.k7x"), {
    type: "lfo",
    shape: "sine",
    frequency: 1,
  });
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

const file = (id = "sweep") => join(dir, "curves", `${id}.k7x`);
type Point = { time: string; value: number };
const points = (id = "sweep") => (wsData(file(id)).points ?? []) as Point[];
/** The times, in the order the FILE lists them — which is the invariant worth holding. */
const times = (id = "sweep") => points(id).map((p) => p.time);
const at = (time: string) => points().find((p) => p.time === time);

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
    expect(at("5:1:1")?.value).toBe(0.25);
    expect(logs.join(" ")).toContain("set the point");
  });

  it("clamps a value outside 0..1 rather than writing it", async () => {
    await runCommand("curve point add sweep 3:1:1 4", host(), "cli");
    expect(at("3:1")?.value).toBe(1);
  });

  it("refuses a curve with no points to edit", async () => {
    const before = readFileSync(file("wobble"), "utf8");
    await runCommand("curve point add wobble 3:1:1 0.5", host(), "cli");
    expect(logs.join(" ")).toContain("only a `type: custom`");
    expect(readFileSync(file("wobble"), "utf8")).toBe(before);
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
    expect(at("7:1")?.value).toBe(1);
  });

  it("takes a new value when one is given", async () => {
    await runCommand("curve point move sweep 5:1:1 7:1:1 0.3", host(), "cli");
    expect(at("7:1")?.value).toBe(0.3);
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
