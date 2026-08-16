// Switching an event's WARP off — `event disable warp`, and the file it writes.
//
// The polarity is the interesting part and is the opposite of `disabled`'s: a warp belongs to the
// CLIP, so every placement of it stretches by default and `warp: false` is a placement declining
// that. Which means `false` is the written value and `true` is the one that DELETES the field —
// switching it off and back on has to leave the file exactly as it was.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePosition } from "./timecode";
import { setTrackPlacementDisabled, setTrackPlacementWarp } from "./trackMix";

const NUM = 4;
const DEN = 4;
const dirs: string[] = [];

const trackDir = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "td-warp-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "nodes", "drums.yaml"), body, "utf8");
  dirs.push(dir);
  return dir;
};
const laneText = (dir: string) =>
  readFileSync(join(dir, "nodes", "drums.yaml"), "utf8");

const LANE = `extends: "@studio/audio-track"
events:
  - { ref: kick, start: "1:1" }
  - { ref: break, start: "2:1", loop: 2 }
`;

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("setTrackPlacementWarp", () => {
  const at = (tc: string) => parsePosition(tc, NUM, DEN);

  it("writes `warp: false` on the addressed event, and only that one", () => {
    const dir = trackDir(LANE);
    expect(
      setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, false),
    ).toBe(true);
    const text = laneText(dir);
    expect(text).toMatch(/ref: break[^\n]*warp: false/);
    expect(text).toMatch(/ref: kick[^\n]*\}/);
    expect(text.match(/warp:/g)).toHaveLength(1);
  });

  it("DELETES the field when warping is turned back on", () => {
    // The round trip has to leave the file byte-identical, or every event anybody ever touched
    // would carry a `warp: true` saying what its absence already said.
    const dir = trackDir(LANE);
    setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, false);
    setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, true);
    expect(laneText(dir)).toBe(LANE);
  });

  it("leaves the event's other fields alone", () => {
    const dir = trackDir(LANE);
    setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, false);
    expect(laneText(dir)).toContain("loop: 2");
    expect(laneText(dir)).toContain('start: "2:1"');
  });

  it("says so when no event is there, rather than writing one", () => {
    const dir = trackDir(LANE);
    expect(
      setTrackPlacementWarp(dir, "drums", at("9:1"), NUM, DEN, false),
    ).toBe(false);
    expect(laneText(dir)).toBe(LANE);
  });

  it("is independent of `disabled`, which has the opposite polarity", () => {
    // The two flags sit on the same placement and neither writer may disturb the other.
    const dir = trackDir(LANE);
    setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, false);
    setTrackPlacementDisabled(dir, "drums", at("2:1"), NUM, DEN, true);
    expect(laneText(dir)).toMatch(/warp: false/);
    expect(laneText(dir)).toMatch(/disabled: true/);
    // …and taking one back leaves the other standing.
    setTrackPlacementDisabled(dir, "drums", at("2:1"), NUM, DEN, false);
    expect(laneText(dir)).toMatch(/warp: false/);
    expect(laneText(dir)).not.toMatch(/disabled/);
  });
});
