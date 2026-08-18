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
import { joinTrackPlacements, splitTrackPlacement } from "./trackMix";

/**
 * Putting a run of events back together — `event split` read backwards.
 *
 * ONE PLACEMENT OUT OF SEVERAL, and, like the split, nothing is rendered and no material is
 * written: the first keeps its start and its `from`, takes the last one's `to`, and the others go.
 * The test a join has to pass is the split's own test in reverse — what the run played is what the
 * one event plays — so the case that matters most here is the ROUND TRIP: split then join must
 * leave the file it started from.
 *
 * What it refuses is the other half, and each refusal is the same sentence: a join that had to
 * invent a sample would be a different feature. Different material, a gap, an overlap, and a
 * neighbour that RESTARTS the material rather than continuing it are all that.
 *
 * 120 bpm, 4/4: two beats to the second, so every number below reads off that.
 */

const NUM = 4;
const DEN = 4;
const TEMPO = 120;

function song(
  track: string,
  material: { dir: string; name: string; body: string },
): string {
  const dir = mkdtempSync(join(tmpdir(), "td-join-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  mkdirSync(join(dir, material.dir), { recursive: true });
  writeFileSync(join(dir, "nodes", "drums.yaml"), track, "utf8");
  writeFileSync(
    join(dir, material.dir, `${material.name}.yaml`),
    material.body,
    "utf8",
  );
  return dir;
}
const clipSong = (events: string, body = "source: clips/kick.wav\n") =>
  song(`extends: "@studio/audio-track"\n${events}`, {
    dir: "clips",
    name: "kick",
    body,
  });
const seqSong = (
  events: string,
  body = "notes:\n  - { t: 0, d: 1, k: 36 }\n",
) =>
  song(`extends: "@studio/sequence-track"\n${events}`, {
    dir: "sequences",
    name: "kick",
    body,
  });
const lane = (dir: string) =>
  readFileSync(join(dir, "nodes", "drums.yaml"), "utf8");
const split = (dir: string, at: number, cut: number) =>
  splitTrackPlacement(dir, "drums", at, NUM, DEN, cut, TEMPO);
const rejoin = (dir: string, from: number, to: number) =>
  joinTrackPlacements(dir, "drums", from, to, NUM, DEN, TEMPO);

describe("the round trip", () => {
  it("leaves an AUDIO lane exactly as it was before the split", () => {
    // The whole claim, in one assertion: cutting and rejoining is a no-op on the file. A `to`
    // left behind, or a `from: 0` written where there was none, would both play the same and
    // read as a lane somebody had been at.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      const before = lane(dir);
      split(dir, 0, 4);
      expect(lane(dir)).not.toBe(before);
      expect(rejoin(dir, 0, 4)).toMatchObject({ kind: "audio", joined: 2 });
      expect(lane(dir)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a SEQUENCE lane exactly as it was, whose window is in BEATS", () => {
    // The other unit. One verb, two materials — the conversion is `event resize`'s, and getting
    // it wrong here would write seconds into a file that means beats.
    const dir = seqSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      const before = lane(dir);
      split(dir, 0, 4);
      expect(rejoin(dir, 0, 4)).toMatchObject({ kind: "sequence", joined: 2 });
      expect(lane(dir)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts THREE back together, in one pass", () => {
    // Split twice, join once. A run is a run whatever its length, and the rectangle is what says
    // where it stops — so the loop has to carry the last one's end onto the first, not the second's.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      const before = lane(dir);
      split(dir, 0, 4);
      split(dir, 4, 6);
      expect(rejoin(dir, 0, 8)).toMatchObject({ joined: 3 });
      expect(lane(dir)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what it will not join", () => {
  it("refuses two different materials, and names both", () => {
    // `bass` after `kick` cannot become one placement without rendering a new file, which is a
    // different feature. The message has to name what it saw or there is nothing to act on.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1", to: 2 }\n  - { ref: snare, start: "3:1", from: 2 }\n',
    );
    try {
      writeFileSync(
        join(dir, "clips", "snare.yaml"),
        "source: clips/snare.wav\n",
        "utf8",
      );
      expect(() => rejoin(dir, 0, 8)).toThrow(/kick.*snare|snare.*kick/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a GAP, because closing it would move when something sounds", () => {
    // Two halves dragged apart are no longer the run they were. Joining them would have to
    // choose between moving the tail and stretching the head, and both are edits nobody asked for.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1", to: 2 }\n  - { ref: kick, start: "3:1", from: 2 }\n',
    );
    try {
      expect(() => rejoin(dir, 0, 8)).toThrow(/gap/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an OVERLAP for the same reason, said the other way round", () => {
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1", to: 2 }\n  - { ref: kick, start: "1:3", from: 2 }\n',
    );
    try {
      expect(() => rejoin(dir, 0, 8)).toThrow(/overlap/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The one that is NOT obvious, and the reason this is not "are they touching?".
   *
   * Two copies of one clip laid back to back are contiguous on the timeline and are not one
   * event: the second plays the material again from the top. Joining them would leave a single
   * placement half as long, and a playthrough would vanish with nothing said.
   */
  it("refuses a neighbour that RESTARTS the material rather than continuing it", () => {
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1", to: 2 }\n  - { ref: kick, start: "2:1", to: 2 }\n',
    );
    try {
      expect(() => rejoin(dir, 0, 8)).toThrow(/restarts|drop a playthrough/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a LOOPED event, for the reason a split refuses one", () => {
    // What its window is has as many answers as it has passes.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1", to: 2, loop: 3 }\n  - { ref: kick, start: "3:1", from: 2 }\n',
    );
    try {
      expect(() => rejoin(dir, 0, 8)).toThrow(/repeats/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a run whose first event never says where it ends", () => {
    // Nothing to check the next one against, and nothing to carry over. A split always writes
    // that `to`, so this is a hand-written file — which is exactly when a clear refusal earns its keep.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1" }\n  - { ref: kick, start: "3:1", from: 2 }\n',
    );
    try {
      expect(() => rejoin(dir, 0, 8)).toThrow(/where it ends/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what it does not treat as a failure", () => {
  it("answers null on a range holding ONE event", () => {
    // A rectangle that caught one thing. Not an error — the caller says it better, knowing what
    // was selected; an exception here would put a red line under an ordinary miss.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      expect(rejoin(dir, 0, 8)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers null on a range holding none", () => {
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      expect(rejoin(dir, 100, 200)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes only what the range CONTAINS, leaving the rest of the lane alone", () => {
    // Selection is by where an event STARTS, both ends inclusive — the same rule `events move`
    // uses, so one rectangle means the same set of events whichever verb reads it.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      split(dir, 0, 4);
      split(dir, 4, 6);
      // Beats 0 and 4 only: the third event opens at beat 6 and stays put.
      expect(rejoin(dir, 0, 4)).toMatchObject({ joined: 2 });
      const out = lane(dir);
      expect(out).toContain('start: "2:3"'); // the untouched third, still where it was
      expect(out.match(/ref: kick/g)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
