import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePosition } from "./timecode";
import { moveTrackPlacement } from "./trackMix";

// Dragging a clip. The property that matters is that the file comes back with ONE line
// different: a track file is hand-editable, and a drag that reflowed it would bury the
// change in the diff and lose whatever the author wrote around it.
//
// A placement is addressed by POSITION IN BEATS, not by the text of its `start` — which is
// the key the caller holds from the compiled project, and what makes "2:1:1", "2:1" and the
// beat value 4 the same event.

const NUM = 4;
const DEN = 4;

function trackDir(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "td-move-"));
  mkdirSync(join(dir, "tracks"), { recursive: true });
  writeFileSync(join(dir, "tracks", "drums.yaml"), body, "utf8");
  return dir;
}
const read = (dir: string) =>
  readFileSync(join(dir, "tracks", "drums.yaml"), "utf8");

describe("moveTrackPlacement", () => {
  it("rewrites ONLY the matching placement, leaving every other line identical", () => {
    const before = `# the drum lane
type: single
contentType: audio
clips:
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
    // The snare moved; its fade, its pass count and its disabled flag travelled with it, on
    // one line as before. A move rewrites the placement's own line and nothing else — the
    // same trade chainsFile.ts makes: one canonical form, or the first edit re-spaces the
    // whole file instead of one line.
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
    const dir = trackDir('clips:\n  - { ref: kick, start: "2:1:1" }\n');
    moveTrackPlacement(dir, "drums", 4, "3:1:1", NUM, DEN);
    expect(read(dir)).toContain('start: "3:1:1"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches by position, not string — 2:1:1 and its beat value are the same event", () => {
    const dir = trackDir('clips:\n  - { ref: kick, start: "2:1:1" }\n');
    // 4/4: bar 2 beat 1 == 4 beats. Pass the beat value; it still finds "2:1:1".
    expect(moveTrackPlacement(dir, "drums", 4, "3:1:1", NUM, DEN)).toBe(true);
    expect(read(dir)).toContain("ref: kick");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false, and writes nothing, when nothing sits at the position", () => {
    const body = 'clips:\n  - { ref: kick, start: "1:1:1" }\n';
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
    const dir = trackDir('clips:\n  - { ref: start_kick, start: "1:1:1" }\n');
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
