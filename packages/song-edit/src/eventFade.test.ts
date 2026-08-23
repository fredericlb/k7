// An event's FADES — `event fadein` / `event fadeout`, and the file they write.
//
// Two things are easy to get wrong here and neither is visible in a diff. A fade is a DURATION, so
// it is spelled with `beatsToDuration` and read back with `parseDuration`: one beat is `0:1`,
// where the same number as a POSITION is `1:2`. Write it as a position and the fade reads back as
// five beats instead of one — silently, on a field no schema can catch, since both spellings are
// legal timecodes.
//
// And a fade of nothing is the ABSENCE of a fade, like `disabled: false` before it: dragging a
// fade open and closed again has to leave the file exactly as it was.

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
import { compileNodeProject } from "@studio/song/nodeProject";
import {
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song-schema/timecode";
import { afterEach, describe, expect, it } from "vitest";
import { setTrackPlacementFade } from "./trackMix";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "node-demo.st0",
);

const NUM = 4;
const DEN = 4;
const dirs: string[] = [];

const trackDir = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "td-fade-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "nodes", "drums.yaml"), body, "utf8");
  dirs.push(dir);
  return dir;
};
const laneText = (dir: string) =>
  readFileSync(join(dir, "nodes", "drums.yaml"), "utf8");

const LANE = `extends: "@studio/track"
events:
  - { ref: kick, start: "1:1" }
  - { ref: break, start: "2:1", loop: 2 }
`;

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
    const text = laneText(dir);
    expect(text).toMatch(/ref: break[^\n]*fadeIn:/);
    expect(text).not.toMatch(/ref: kick[^\n]*fade/);
  });

  it("spells a fade as a DURATION, not as a position", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeIn", 1);
    const written = /fadeIn:\s*"([^"]+)"/.exec(laneText(dir))?.[1] ?? "";
    // `beatsToDuration` drops a trailing zero tick, so one beat is "0:1" rather than "0:1:0".
    // Pinning the ROUND TRIP rather than the spelling: what matters is that the compiler reads
    // back the number we meant, and the same beats as a POSITION would be "1:2" — five beats.
    expect(parseDuration(written, NUM, DEN)).toBeCloseTo(1, 6);
    expect(written).not.toBe(beatsToPosition(1, NUM, DEN));
  });

  it("round-trips a fade longer than a bar", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeOut", 6);
    const written = /fadeOut:\s*"([^"]+)"/.exec(laneText(dir))?.[1] ?? "";
    expect(parseDuration(written, NUM, DEN)).toBeCloseTo(6, 6);
  });

  it("holds both fades on one event", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeIn", 1);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeOut", 2);
    const text = laneText(dir);
    expect(text).toMatch(/fadeIn:/);
    expect(text).toMatch(/fadeOut:/);
  });

  it("a fade of zero DELETES the key — open and closed leaves the file untouched", () => {
    const dir = trackDir(LANE);
    const before = laneText(dir);
    setTrackPlacementFade(dir, "drums", at("2:1"), NUM, DEN, "fadeIn", 2);
    expect(laneText(dir)).toMatch(/fadeIn:/);
    setTrackPlacementFade(dir, "drums", at("2:1"), NUM, DEN, "fadeIn", 0);
    expect(laneText(dir)).not.toMatch(/fadeIn:/);
    expect(laneText(dir)).toBe(before);
  });

  it("a negative fade is a zero one, not a written negative", () => {
    const dir = trackDir(LANE);
    setTrackPlacementFade(dir, "drums", at("1:1"), NUM, DEN, "fadeIn", -3);
    expect(laneText(dir)).not.toMatch(/fadeIn:/);
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
  // The writer and the reader are two halves of one agreement, and a test on either alone cannot
  // see them disagree. `setTrackPlacementFade` spells beats with `beatsToDuration`;
  // `placementToClip` reads them back with `parseDuration`. If either ever moved to the POSITION
  // spelling, a one-beat fade would compile as five and nothing would say so.
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
