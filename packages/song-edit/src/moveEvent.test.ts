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
import { describe, expect, it } from "vitest";
import { moveTrackPlacement, moveTrackPlacementsInRange } from "./trackMix";

// Dragging a clip: ONE line different, and the placement addressed by POSITION IN BEATS.

const NUM = 4;
const DEN = 4;

function trackDir(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "td-move-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "nodes", "drums.yaml"), body, "utf8");
  return dir;
}
const read = (dir: string) =>
  readFileSync(join(dir, "nodes", "drums.yaml"), "utf8");

describe("moveTrackPlacement", () => {
  it("rewrites ONLY the matching placement, leaving every other line identical", () => {
    const before = `# the drum lane
extends: "@meta/track"
events:
  - { ref: kick, start: "1:1:1", fadeIn: "0:1" }
  - { ref: snare, start: "2:1:1", fadeIn: "0:1", loop: 2, disabled: true }
`;
    const dir = trackDir(before);
    const moved = moveTrackPlacement(
      dir,
      "drums",
      parsePosition("2:1:1", NUM, DEN),
      "3:1:1",
      NUM,
      DEN,
    );
    expect(moved).toBe(true);
    const after = read(dir);
    // The snare moved with its fade, its pass count and its flag, on one line as before.
    expect(after).toContain(
      '- { ref: snare, start: "3:1:1", fadeIn: "0:1", loop: 2, disabled: true }',
    );
    // Exactly one line differs — the comment, the kick and the field order all survive.
    expect(
      after.split("\n").filter((l, i) => l !== before.split("\n")[i]),
    ).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the moved timecode QUOTED", () => {
    // Unquoted, `3:1:1` is a YAML 1.1 sexagesimal: the clip would reload at beat 11461.
    const dir = trackDir('events:\n  - { ref: kick, start: "2:1:1" }\n');
    moveTrackPlacement(dir, "drums", 4, "3:1:1", NUM, DEN);
    expect(read(dir)).toContain('start: "3:1:1"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches by position, not string — 2:1:1 and its beat value are the same event", () => {
    const dir = trackDir('events:\n  - { ref: kick, start: "2:1:1" }\n');
    // 4/4: bar 2 beat 1 == 4 beats. Pass the beat value; it still finds "2:1:1".
    expect(moveTrackPlacement(dir, "drums", 4, "3:1:1", NUM, DEN)).toBe(true);
    expect(read(dir)).toContain("ref: kick");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false, and writes nothing, when nothing sits at the position", () => {
    const body = 'events:\n  - { ref: kick, start: "1:1:1" }\n';
    const dir = trackDir(body);
    expect(
      moveTrackPlacement(
        dir,
        "drums",
        parsePosition("9:1:1", NUM, DEN),
        "3:1:1",
        NUM,
        DEN,
      ),
    ).toBe(false);
    expect(read(dir)).toBe(body); // byte-identical, not merely equivalent
    rmSync(dir, { recursive: true, force: true });
  });

  it("doesn't confuse `start` with a ref name that contains it", () => {
    const dir = trackDir('events:\n  - { ref: start_kick, start: "1:1:1" }\n');
    expect(moveTrackPlacement(dir, "drums", 0, "2:1:1", NUM, DEN)).toBe(true);
    expect(read(dir)).toContain("ref: start_kick");
    expect(read(dir)).toContain('start: "2:1:1"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws for a track with no file", () => {
    const dir = mkdtempSync(join(tmpdir(), "td-move-"));
    expect(() => moveTrackPlacement(dir, "nope", 0, "2:1:1", NUM, DEN)).toThrow(
      /no file/,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

// The bulk form: the starts are collected before any is rewritten — see docs/trackMix.md.
describe("moveTrackPlacementsInRange", () => {
  it("moves every placement starting in the range, and only those, one line each", () => {
    const before = `# the drum lane
extends: "@meta/track"
events:
  - { ref: intro, start: "1:1:1" }
  - { ref: kick, start: "2:1:1", fadeIn: "0:1" }
  - { ref: snare, start: "3:3", loop: 2 }
  - { ref: outro, start: "9:1:1" }
`;
    const dir = trackDir(before);
    const n = moveTrackPlacementsInRange(
      dir,
      "drums",
      parsePosition("2:1", NUM, DEN),
      parsePosition("4:4", NUM, DEN),
      4, // one bar right, in 4/4
      NUM,
      DEN,
    );
    expect(n).toBe(2);
    const after = read(dir);
    // The two inside moved a bar, everything they carried travelling with them…
    expect(after).toContain('- { ref: kick, start: "3:1", fadeIn: "0:1" }');
    expect(after).toContain('- { ref: snare, start: "4:3", loop: 2 }');
    // …and the two outside, the comment and the field order all survive: two lines differ.
    expect(after).toContain('- { ref: intro, start: "1:1:1" }');
    expect(after).toContain('- { ref: outro, start: "9:1:1" }');
    expect(
      after.split("\n").filter((l, i) => l !== before.split("\n")[i]),
    ).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("includes both endpoints — an event sitting AT `to` moves", () => {
    const dir = trackDir(
      'events:\n  - { ref: a, start: "2:1" }\n  - { ref: b, start: "4:1" }\n',
    );
    const n = moveTrackPlacementsInRange(
      dir,
      "drums",
      parsePosition("2:1", NUM, DEN),
      parsePosition("4:1", NUM, DEN),
      1,
      NUM,
      DEN,
    );
    expect(n).toBe(2);
    expect(read(dir)).toContain('start: "2:2"');
    expect(read(dir)).toContain('start: "4:2"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("moves left too, and keeps the rewritten timecodes quoted", () => {
    const dir = trackDir('events:\n  - { ref: a, start: "3:1:1" }\n');
    expect(moveTrackPlacementsInRange(dir, "drums", 0, 100, -4, NUM, DEN)).toBe(
      1,
    );
    expect(read(dir)).toContain('start: "2:1"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 0 and writes nothing when the range holds no placement", () => {
    const body = 'events:\n  - { ref: a, start: "1:1:1" }\n';
    const dir = trackDir(body);
    expect(
      moveTrackPlacementsInRange(
        dir,
        "drums",
        parsePosition("5:1", NUM, DEN),
        parsePosition("9:1", NUM, DEN),
        4,
        NUM,
        DEN,
      ),
    ).toBe(0);
    expect(read(dir)).toBe(body); // byte-identical, not merely equivalent
    rmSync(dir, { recursive: true, force: true });
  });
});
