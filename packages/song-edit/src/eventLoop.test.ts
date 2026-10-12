// eventLoop.test.ts — the loop switch writes `loop` and nothing else it does not need, an audio event with no
// end gets its file's length as one, and moving the points keeps a looped event's length on the lane.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePosition } from "@studio/song-schema/timecode";
import { afterEach, describe, expect, it } from "vitest";
import {
  setTrackPlacementLoop,
  setTrackPlacementLoopPoints,
} from "./eventLoop";

const NUM = 4;
const DEN = 4;
const TEMPO = 120;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A lane holding `events`, a 4-bar sequence `pat` (16 one-beat notes) and an audio clip `vox` stating no `to`. */
function song(events: string): string {
  const dir = mkdtempSync(join(tmpdir(), "evloop-"));
  dirs.push(dir);
  for (const d of ["nodes", "sequences", "clips"]) mkdirSync(join(dir, d));
  writeFileSync(
    join(dir, "nodes", "lane.yaml"),
    `extends: "@meta/track"\nevents:\n${events}`,
  );
  const notes = Array.from(
    { length: 16 },
    (_, i) => `  - { t: ${i}, d: 1, k: ${60 + (i % 12)} }`,
  );
  writeFileSync(
    join(dir, "sequences", "pat.yaml"),
    `notes:\n${notes.join("\n")}\n`,
  );
  writeFileSync(join(dir, "clips", "vox.yaml"), "source: vox.wav\n");
  return dir;
}
const lane = (dir: string) =>
  readFileSync(join(dir, "nodes", "lane.yaml"), "utf8");
const at = (tc: string) => parsePosition(tc, NUM, DEN);

describe("setTrackPlacementLoop", () => {
  it("switches a sequence event to two passes, and back to one by deleting the key", () => {
    const dir = song(`  - { ref: pat, start: "1:1" }\n`);
    expect(
      setTrackPlacementLoop(dir, "lane", at("1:1"), NUM, DEN, TEMPO, true),
    ).toEqual({ loops: 2, changed: true });
    expect(lane(dir)).toMatch(/loop: 2/);
    expect(
      setTrackPlacementLoop(dir, "lane", at("1:1"), NUM, DEN, TEMPO, false),
    ).toEqual({ loops: 1, changed: true });
    expect(lane(dir)).not.toMatch(/loop/);
  });

  it("leaves a loop that is already on as it was, passes and all", () => {
    const dir = song(`  - { ref: pat, start: "1:1", loop: 6 }\n`);
    expect(
      setTrackPlacementLoop(dir, "lane", at("1:1"), NUM, DEN, TEMPO, true),
    ).toEqual({ loops: 6, changed: false });
    expect(lane(dir)).toMatch(/loop: 6/);
  });

  it("gives an audio event with no end its file's length, or refuses without one", () => {
    const dir = song(`  - { ref: vox, start: "1:1" }\n`);
    expect(() =>
      setTrackPlacementLoop(dir, "lane", at("1:1"), NUM, DEN, TEMPO, true),
    ).toThrow(/length is not known/);
    setTrackPlacementLoop(
      dir,
      "lane",
      at("1:1"),
      NUM,
      DEN,
      TEMPO,
      true,
      12.345678,
    );
    expect(lane(dir)).toMatch(/to: 12\.3456/);
    expect(lane(dir)).toMatch(/loop: 2/);
  });
});

describe("setTrackPlacementLoopPoints", () => {
  it("writes a sequence event's points as positions, and a single pass keeps its one pass", () => {
    const dir = song(`  - { ref: pat, start: "1:1" }\n`);
    const r = setTrackPlacementLoopPoints(
      dir,
      "lane",
      at("1:1"),
      NUM,
      DEN,
      TEMPO,
      4,
      8,
    );
    expect(r).toMatchObject({ kind: "sequence", from: 4, to: 8, loops: 1 });
    expect(lane(dir)).toMatch(/from: "2:1"/);
    expect(lane(dir)).toMatch(/to: "3:1"/);
  });

  it("keeps a looped event's length on the lane: a window halved plays twice as many passes", () => {
    // Two passes of the whole 16-beat sequence: 32 beats on the lane.
    const dir = song(`  - { ref: pat, start: "1:1", loop: 2 }\n`);
    const r = setTrackPlacementLoopPoints(
      dir,
      "lane",
      at("1:1"),
      NUM,
      DEN,
      TEMPO,
      0,
      8,
    );
    expect(r?.loops).toBe(4);
    expect(lane(dir)).toMatch(/loop: 4/);
    // The start on the material's own start is the default, so it is not written.
    expect(lane(dir)).not.toMatch(/from:/);
  });

  it("never lets a looped event drop to one pass", () => {
    const dir = song(
      `  - { ref: pat, start: "1:1", from: "1:1", to: "2:1", loop: 2 }\n`,
    );
    expect(
      setTrackPlacementLoopPoints(
        dir,
        "lane",
        at("1:1"),
        NUM,
        DEN,
        TEMPO,
        0,
        16,
      )?.loops,
    ).toBe(2);
  });

  it("writes an audio event's points in seconds, and refuses points that run backwards", () => {
    const dir = song(`  - { ref: vox, start: "1:1", to: 10, loop: 2 }\n`);
    const r = setTrackPlacementLoopPoints(
      dir,
      "lane",
      at("1:1"),
      NUM,
      DEN,
      TEMPO,
      1.5,
      6.5,
    );
    expect(r).toMatchObject({ kind: "audio", from: 1.5, to: 6.5, loops: 4 });
    expect(lane(dir)).toMatch(/from: 1\.5/);
    expect(() =>
      setTrackPlacementLoopPoints(
        dir,
        "lane",
        at("1:1"),
        NUM,
        DEN,
        TEMPO,
        5,
        5,
      ),
    ).toThrow(/forwards/);
  });

  it("answers null for a start no event sits at", () => {
    const dir = song(`  - { ref: pat, start: "1:1" }\n`);
    expect(
      setTrackPlacementLoopPoints(
        dir,
        "lane",
        at("3:1"),
        NUM,
        DEN,
        TEMPO,
        0,
        4,
      ),
    ).toBeNull();
  });
});
