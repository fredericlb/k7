// Putting an existing clip on a lane — a REFERENCE, on the set the lane is PLAYING; docs/trackMix.md.

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
import { addTrackPlacement, addTrackPlacements } from "./trackMix";

let dir: string;

type Lane = {
  events?: Record<string, unknown>[];
  alternatives?: { events?: Record<string, unknown>[] }[];
};

const lane = (body: string) =>
  writeFileSync(join(dir, "nodes", "gtr.k7x"), body, "utf8");
const laneText = () => readFileSync(join(dir, "nodes", "gtr.k7x"), "utf8");
const laneData = () => parse(laneText()) as Lane;

const TRACK = 'extends("@meta/track")\n';
const ON_B =
  'extends("@meta/track")\nevents([])\nalternatives([name("b").events([])])\nalternative("b")\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-add-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("putting a clip on a lane", () => {
  it("writes the reference and the position, and nothing else", () => {
    lane(TRACK);
    addTrackPlacement(dir, "gtr", "riff", "3:1");
    // No length: how long it sounds is the material's window (see PlacementSchema).
    expect(laneData().events).toEqual([{ ref: "riff", start: "3:1" }]);
  });

  it("creates the clips list on a lane that had none", () => {
    lane(TRACK);
    addTrackPlacement(dir, "gtr", "riff", "1:1");
    expect(laneText()).toContain("events(");
  });

  it("keeps the placements already there, and their comments", () => {
    lane(
      `${TRACK}events([\n  // the intro\n  ref("first").start("1:1"),\n])\n`,
    );
    addTrackPlacement(dir, "gtr", "second", "5:1");
    expect(laneData().events?.map((e) => e.ref)).toEqual(["first", "second"]);
    expect(laneText()).toContain("// the intro");
  });

  it("lands on the set the lane is PLAYING, not the first one", () => {
    lane(ON_B);
    addTrackPlacement(dir, "gtr", "riff", "2:1");
    // The running set gets it; the file's top-level list stays empty.
    const data = laneData();
    expect(data.events).toEqual([]);
    expect(data.alternatives?.[0].events).toEqual([
      { ref: "riff", start: "2:1" },
    ]);
  });

  it("refuses a lane that has no file, naming what it could not do", () => {
    expect(() => addTrackPlacement(dir, "nosuch", "riff", "1:1")).toThrow(
      /nosuch/,
    );
  });

  it("does not touch the clip itself — a placement is a reference", () => {
    lane(TRACK);
    mkdirSync(join(dir, "clips"), { recursive: true });
    const clip = join(dir, "clips", "riff.k7x");
    writeFileSync(clip, 'source("clips/riff.wav")\n', "utf8");
    addTrackPlacement(dir, "gtr", "riff", "1:1");
    expect(readFileSync(clip, "utf8")).toBe('source("clips/riff.wav")\n');
  });
});

// The bulk form a PASTE lands through: one rewrite of the lane's file, so it is atomic.
describe("putting several on a lane at once", () => {
  it("writes every one, keeping what was there", () => {
    lane(`${TRACK}events([ref("first").start("1:1")])\n`);
    addTrackPlacements(dir, "gtr", [
      { ref: "riff", start: "3:1" },
      { ref: "riff", start: "5:1" },
      { ref: "solo", start: "7:1" },
    ]);
    expect(laneData().events).toEqual([
      { ref: "first", start: "1:1" },
      { ref: "riff", start: "3:1" },
      { ref: "riff", start: "5:1" },
      { ref: "solo", start: "7:1" },
    ]);
  });

  it("keeps a loop count when one is given, and writes none otherwise", () => {
    lane(TRACK);
    addTrackPlacements(dir, "gtr", [
      { ref: "riff", start: "1:1", loop: 4 },
      { ref: "solo", start: "9:1" },
    ]);
    expect(laneData().events).toEqual([
      { ref: "riff", start: "1:1", loop: 4 },
      { ref: "solo", start: "9:1" },
    ]);
  });

  /** The WHOLE placement: a trimmed, faded event pasted as an untrimmed one is the bug this pins. */
  it("writes the window, the fades and the flags a paste hands it", () => {
    lane(TRACK);
    const whole = {
      ref: "riff",
      start: "3:1",
      from: 1.5,
      to: 6.5455,
      fadeIn: "0:2",
      fadeOut: "0:1",
      loop: 3,
      disabled: true,
      warp: false,
    };
    addTrackPlacements(dir, "gtr", [whole]);
    expect(laneData().events).toEqual([whole]);
  });

  it("keeps a window spelled as a timecode a timecode", () => {
    lane(TRACK);
    addTrackPlacements(dir, "gtr", [
      { ref: "seq", start: "1:1", from: "2:1", to: "4:1" },
    ]);
    expect(laneData().events?.[0]).toMatchObject({ from: "2:1", to: "4:1" });
  });

  it("is ONE rewrite, so the same material may repeat at several positions", () => {
    lane(TRACK);
    addTrackPlacements(
      dir,
      "gtr",
      [1, 2, 3, 4].map((n) => ({ ref: "riff", start: `${n}:1` })),
    );
    expect(laneData().events?.filter((e) => e.ref === "riff")).toHaveLength(4);
  });

  it("lands on the set the lane is PLAYING, like the singular", () => {
    lane(ON_B);
    addTrackPlacements(dir, "gtr", [{ ref: "riff", start: "2:1" }]);
    const data = laneData();
    expect(data.events).toEqual([]);
    expect(data.alternatives?.[0].events).toEqual([
      { ref: "riff", start: "2:1" },
    ]);
  });

  it("refuses a lane that has no file, before writing anything", () => {
    expect(() =>
      addTrackPlacements(dir, "nosuch", [{ ref: "riff", start: "1:1" }]),
    ).toThrow(/nosuch/);
  });
});
