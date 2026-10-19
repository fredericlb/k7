// An event's FADES: a DURATION, and a fade of nothing is its absence — see docs/trackMix.md.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@studio/k7x/document";
import { compileNodeProject } from "@studio/song/nodeProject";
import {
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song-schema/timecode";
import { afterEach, describe, expect, it } from "vitest";
import { setTrackPlacementFade } from "./trackMix";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(here, "..", "..", "..", "demos", "node-demo.k7");

const NUM = 4;
const DEN = 4;
const dirs: string[] = [];

const trackDir = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "td-fade-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "nodes", "drums.k7x"), body, "utf8");
  dirs.push(dir);
  return dir;
};
const laneText = (dir: string) =>
  readFileSync(join(dir, "nodes", "drums.k7x"), "utf8");

const LANE = `extends("@meta/track")
events([
  ref("kick").start("1:1"),
  ref("break").start("2:1").loop(2),
])
`;
const events = (dir: string) =>
  parse(laneText(dir)).events as Record<string, unknown>[];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("setTrackPlacementFade", () => {
  const at = (tc: string) => parsePosition(tc, NUM, DEN);

  it("writes the fade on the addressed event, and only that one", () => {
    const dir = trackDir(LANE);
    expect(
      setTrackPlacementFade(dir, "drums", at("2:1"), NUM, DEN, "fadeIn", 1),
    ).toBe(true);
    expect(events(dir)[1].fadeIn).toBeDefined();
    expect(events(dir)[0]).toEqual({ ref: "kick", start: "1:1" });
  });

  it("spells a fade as a DURATION, not as a position", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeIn", 1);
    const written = String(events(dir)[0].fadeIn);
    // The ROUND TRIP rather than the spelling: the same beats as a POSITION would be "1:2".
    expect(parseDuration(written, NUM, DEN)).toBeCloseTo(1, 6);
    expect(written).not.toBe(beatsToPosition(1, NUM, DEN));
  });

  it("round-trips a fade longer than a bar", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeOut", 6);
    const written = String(events(dir)[0].fadeOut);
    expect(parseDuration(written, NUM, DEN)).toBeCloseTo(6, 6);
  });

  it("holds both fades on one event", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeIn", 1);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeOut", 2);
    expect(Object.keys(events(dir)[0])).toEqual([
      "ref",
      "start",
      "fadeIn",
      "fadeOut",
    ]);
  });

  it("a fade of zero DELETES the key — open and closed leaves the file untouched", () => {
    const dir = trackDir(LANE);
    const before = laneText(dir);
    setTrackPlacementFade(dir, "drums", at("2:1"), NUM, DEN, "fadeIn", 2);
    expect(events(dir)[1].fadeIn).toBeDefined();
    setTrackPlacementFade(dir, "drums", at("2:1"), NUM, DEN, "fadeIn", 0);
    expect(laneText(dir)).toBe(before);
  });

  it("a negative fade is a zero one, not a written negative", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeIn", -3);
    expect(laneText(dir)).toBe(LANE);
  });

  it("says no when nothing is at that beat, and writes nothing", () => {
    const dir = trackDir(LANE);
    const before = laneText(dir);
    expect(
      setTrackPlacementFade(dir, "drums", at("9:1"), NUM, DEN, "fadeIn", 1),
    ).toBe(false);
    expect(laneText(dir)).toBe(before);
  });
});

describe("a fade through the compiler", () => {
  // Writer and reader are two halves of one agreement, and neither alone can see them disagree.
  it("compiles back to the beats it was written with", () => {
    const dir = mkdtempSync(join(tmpdir(), "td-fadec-"));
    dirs.push(dir);
    cpSync(SONG, dir, { recursive: true });
    const kick = () =>
      compileNodeProject(dir)
        .tracks.flatMap((t) => t.clips)
        .find((c) => c.name === "kick");

    const at = parsePosition("1:1:1", NUM, DEN);
    expect(kick()?.fadeIn).toBe(0);

    setTrackPlacementFade(dir, "drums", at, NUM, DEN, "fadeIn", 1);
    setTrackPlacementFade(dir, "drums", at, NUM, DEN, "fadeOut", 2.5);
    expect(kick()?.fadeIn).toBeCloseTo(1, 6);
    expect(kick()?.fadeOut).toBeCloseTo(2.5, 6);

    // …and removing it returns the compiled clip to the default, not to some written zero.
    setTrackPlacementFade(dir, "drums", at, NUM, DEN, "fadeIn", 0);
    expect(kick()?.fadeIn).toBe(0);
  });
});
