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
import { loadLanes } from "./loader";
import { splitTrackPlacement } from "./trackMix";

/**
 * Cutting an event in two — TWO PLACEMENTS OF ONE MATERIAL.
 *
 * Nothing is rendered and the clip's own file is not touched: the head keeps its start and gains a
 * `to` at the cut, the tail is a copy of the same placement opening there. Played back to back the
 * pair is what the event was, which is the test a split has to pass and the reason this is a
 * placement edit rather than a material one.
 *
 * A placement's window is SECONDS into an audio file and BEATS into a sequence, so both kinds are
 * exercised here — one verb, two units, and the conversion is the one `event resize` uses.
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
  const dir = mkdtempSync(join(tmpdir(), "td-split-"));
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

describe("cutting an audio event", () => {
  it("stops the head at the cut and opens the tail there, in SECONDS", () => {
    // Placed at beat 0, cut at beat 4 — two seconds into the file at 120 bpm.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      expect(split(dir, 0, 4)).toMatchObject({ kind: "audio", at: 2 });
      const out = lane(dir);
      expect(out).toContain("to: 2");
      expect(out).toContain("from: 2");
      // …and both halves still name the same material, which is the whole point.
      expect([...out.matchAll(/ref: kick/g)]).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * THE TAIL HAS TO PLAY SOMETHING, and for a long time it did not.
   *
   * The tail is copied from the head, and the head has by then been given the cut as its `to` — so
   * the copy came out with `from == to`: a second half of zero length, silent. The test above
   * passed throughout, because it asks whether `to:` and `from:` appear in the file and they did,
   * on the same placement. "Both halves are there" is not "both halves sound".
   *
   * Read as a window rather than as text, which is what makes it a test of the split's own claim:
   * play them back to back and you hear what you heard before.
   */
  it("gives the tail the EVENT's end, not the cut — a silent half is not a half", () => {
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1", to: 5 }\n');
    try {
      split(dir, 0, 4);
      const events = [...lane(dir).matchAll(/\{[^}]*\}/g)].map((m) => m[0]);
      expect(events).toHaveLength(2);
      // The head: from the event's start to the cut. The tail: from the cut to where it ended.
      expect(events[0]).toContain("to: 2");
      expect(events[1]).toContain("from: 2");
      expect(events[1]).toContain("to: 5");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears the tail's end when the event never stated one", () => {
    // Nothing to restore, and a `to` inherited from the head would be the zero-length half again.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      split(dir, 0, 4);
      const events = [...lane(dir).matchAll(/\{[^}]*\}/g)].map((m) => m[0]);
      expect(events[1]).toContain("from: 2");
      expect(events[1]).not.toContain("to:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the CLIP's own file alone — the material is not what was cut", () => {
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      const before = readFileSync(join(dir, "clips", "kick.yaml"), "utf8");
      split(dir, 0, 4);
      expect(readFileSync(join(dir, "clips", "kick.yaml"), "utf8")).toBe(
        before,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("measures the cut from the event's OWN in-point, not from the file's head", () => {
    // The event already opens 1 s in; cutting 4 beats (2 s) later lands at 3 s of the file.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1", from: 1 }\n');
    try {
      expect(split(dir, 0, 4)?.at).toBe(3);
      expect(lane(dir)).toContain("to: 3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carries everything else the placement said onto the tail", () => {
    // `warp: false` is a decision about this material HERE, and it is still true of the half that
    // was cut off. Rebuilding the tail from ref + start would have dropped it silently.
    const dir = clipSong(
      'events:\n  - { ref: kick, start: "1:1", warp: false }\n',
    );
    try {
      split(dir, 0, 4);
      expect([...lane(dir).matchAll(/warp: false/g)]).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the lane loadable, which a window that validates but lies would not", () => {
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      split(dir, 0, 4);
      expect(() => loadLanes(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cutting a sequence event", () => {
  it("writes the window in BEATS, as a timecode", () => {
    // Same gesture, other unit: four beats into a sequence is bar 2 beat 1.
    const dir = seqSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      expect(split(dir, 0, 4)).toMatchObject({ kind: "sequence", at: 4 });
      const out = lane(dir);
      expect(out).toMatch(/to: "?2:1/);
      expect(out).toMatch(/from: "?2:1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("what it refuses", () => {
  const guard = (events: string, at: number, cut: number, re: RegExp) => {
    const dir = clipSong(events);
    try {
      expect(() => split(dir, at, cut)).toThrow(re);
      // …and nothing was written: a refusal that had already edited the file would be worse than
      // no refusal at all.
      expect([...lane(dir).matchAll(/ref: kick/g)]).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("a cut on the event's own start — one half would have no length", () => {
    guard(
      'events:\n  - { ref: kick, start: "1:1" }\n',
      0,
      0,
      /after the event/,
    );
  });

  it("a cut before the event", () => {
    guard(
      'events:\n  - { ref: kick, start: "2:1" }\n',
      4,
      2,
      /after the event/,
    );
  });

  it("a cut past the event's end", () => {
    // The window closes at 2 s, which is beat 4; cutting at beat 6 is outside it.
    guard(
      'events:\n  - { ref: kick, start: "1:1", to: 2 }\n',
      0,
      6,
      /before the event ends/,
    );
  });

  it("a LOOPED event, by name — the cut has one position per pass", () => {
    guard(
      'events:\n  - { ref: kick, start: "1:1", to: 2, loop: 3 }\n',
      0,
      2,
      /repeats 3 times/,
    );
  });

  it("answers null for an event that is not there, rather than throwing", () => {
    // The caller logs "no event on … at …" — a miss is a stale surface, not a broken file.
    const dir = clipSong('events:\n  - { ref: kick, start: "1:1" }\n');
    try {
      expect(split(dir, 99, 100)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
