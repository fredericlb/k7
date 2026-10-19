// Switching an event's WARP off: the polarity is the opposite of `disabled`'s — docs/trackMix.md.

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
import { parsePosition } from "@studio/song-schema/timecode";
import { afterEach, describe, expect, it } from "vitest";
import { setTrackPlacementDisabled, setTrackPlacementWarp } from "./trackMix";

const NUM = 4;
const DEN = 4;
const dirs: string[] = [];

const trackDir = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "td-warp-"));
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

describe("setTrackPlacementWarp", () => {
  const at = (tc: string) => parsePosition(tc, NUM, DEN);

  it("writes `warp: false` on the addressed event, and only that one", () => {
    const dir = trackDir(LANE);
    expect(
      setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, false),
    ).toBe(true);
    expect(events(dir)).toEqual([
      { ref: "kick", start: "1:1" },
      { ref: "break", start: "2:1", loop: 2, warp: false },
    ]);
  });

  it("DELETES the field when warping is turned back on", () => {
    // The round trip must leave the file byte-identical, or every event grows a `warp: true`.
    const dir = trackDir(LANE);
    setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, false);
    setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, true);
    expect(laneText(dir)).toBe(LANE);
  });

  it("leaves the event's other fields alone", () => {
    const dir = trackDir(LANE);
    setTrackPlacementWarp(dir, "drums", at("2:1"), NUM, DEN, false);
    expect(events(dir)[1]).toMatchObject({ start: "2:1", loop: 2 });
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
    expect(events(dir)[1]).toMatchObject({ warp: false, disabled: true });
    // …and taking one back leaves the other standing.
    setTrackPlacementDisabled(dir, "drums", at("2:1"), NUM, DEN, false);
    expect(events(dir)[1]).toEqual({
      ref: "break",
      start: "2:1",
      loop: 2,
      warp: false,
    });
  });
});
