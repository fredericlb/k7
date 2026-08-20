// Cutting and merging MATERIAL, as opposed to placements (trackMix.test.ts's split and join).
//
// The one contract both verbs have: what you hear must not change. A physical split's two halves
// played back to back are the event that was there; a consolidation played once is the rectangle
// that was there, silence included. Every case below is that question asked a different way.
//
// 120 bpm, 4/4 — so a bar is 4 beats and every number reads off that.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  consolidateSequenceMaterial,
  splitSequenceMaterial,
} from "./materialCut";

const NUM = 4;
const DEN = 4;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-matcut-"));
  mkdirSync(join(dir, "nodes"), { recursive: true });
  mkdirSync(join(dir, "sequences"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A sequence file, from a compact note list. */
const seq = (name: string, notes: string, head = "") =>
  writeFileSync(
    join(dir, "sequences", `${name}.yaml`),
    `${head}notes:\n${notes}`,
    "utf8",
  );

/** The lane, carrying `events`. */
const lane = (events: string) =>
  writeFileSync(
    join(dir, "nodes", "drums.yaml"),
    `extends: "@studio/track"\nevents:\n${events}`,
    "utf8",
  );

const read = (rel: string) =>
  parseYaml(readFileSync(join(dir, rel), "utf8")) as {
    notes?: { t: number; d: number; k: number }[];
    from?: string;
    to?: string;
  };

const placements = () =>
  (
    parseYaml(readFileSync(join(dir, "nodes", "drums.yaml"), "utf8")) as {
      events?: Record<string, unknown>[];
    }
  ).events ?? [];

describe("event split, on a sequence", () => {
  beforeEach(() => {
    // Four beats, one note per beat.
    seq(
      "kick",
      "  - { t: 0, d: 1, k: 36 }\n  - { t: 1, d: 1, k: 38 }\n" +
        "  - { t: 2, d: 1, k: 36 }\n  - { t: 3, d: 1, k: 38 }\n",
    );
    lane('  - { ref: kick, start: "1:1:1" }\n');
  });

  it("writes two new sequences and plays one after the other", () => {
    const out = splitSequenceMaterial(dir, "drums", 0, 2, NUM, DEN);
    expect(out).not.toBeNull();
    const { head, tail } = out!;
    // The notes are DIVIDED, not copied: two beats each, and every note kept.
    expect(read(head.file).notes?.map((n) => n.t)).toEqual([0, 1]);
    expect(read(tail.file).notes?.map((n) => n.t)).toEqual([0, 1]);
    // …and the lane plays the pair, back to back at the cut.
    const ev = placements();
    expect(ev).toHaveLength(2);
    expect(ev[0].ref).toBe(head.ref);
    expect(ev[1].ref).toBe(tail.ref);
    expect(ev[1].start).toBe("1:3"); // beat 2 == bar 1, beat 3
  });

  it("leaves the material it cut exactly where it was", () => {
    // Another lane may still be playing it, and this verb cannot know. A sequences/ folder
    // gaining a file is cheap; a project that stops compiling is not.
    splitSequenceMaterial(dir, "drums", 0, 2, NUM, DEN);
    expect(read("sequences/kick.yaml").notes).toHaveLength(4);
  });

  it("truncates a note that STRADDLES the cut rather than dropping it", () => {
    // What was sounding at the cut goes on sounding up to it. Dropping it would make the halves
    // play something the whole never did, which is the one thing a split may not do.
    seq("hold", "  - { t: 0, d: 4, k: 36 }\n");
    lane('  - { ref: hold, start: "1:1:1" }\n');
    const { head, tail } = splitSequenceMaterial(dir, "drums", 0, 1, NUM, DEN)!;
    expect(read(head.file).notes).toEqual([{ t: 0, d: 1, k: 36 }]);
    expect(read(tail.file).notes).toEqual([{ t: 0, d: 3, k: 36 }]);
  });

  it("keeps the extent, so a half that ends in silence still does", () => {
    // The head is cut at beat 3 but its last note stops at 2. Without a `to` the sequence would
    // end where the notes do, and the pair would play a beat shorter than the event did.
    const { head } = splitSequenceMaterial(dir, "drums", 0, 3, NUM, DEN)!;
    expect(read(head.file).to).toBe("1:4"); // three beats
  });

  it("clears the placement's window — the halves are whole materials now", () => {
    // A `from`/`to` left behind would window the NEW file with the OLD file's numbers.
    lane('  - { ref: kick, start: "1:1:1", from: "1:2:1" }\n');
    splitSequenceMaterial(dir, "drums", 0, 2, NUM, DEN);
    for (const p of placements()) {
      expect(p.from).toBeUndefined();
      expect(p.to).toBeUndefined();
    }
  });

  it("cuts inside the placement's WINDOW, not inside the file", () => {
    // The event plays from beat 1 of the material, so a cut one beat in is the material's beat 2.
    lane('  - { ref: kick, start: "1:1:1", from: "1:2:1" }\n');
    const { head, tail } = splitSequenceMaterial(dir, "drums", 0, 1, NUM, DEN)!;
    expect(read(head.file).notes?.map((n) => n.k)).toEqual([38]); // the material's beat 1
    expect(read(tail.file).notes?.map((n) => n.k)).toEqual([36, 38]); // beats 2 and 3
  });

  it("refuses a cut on either edge, where one half would be empty", () => {
    expect(() => splitSequenceMaterial(dir, "drums", 0, 0, NUM, DEN)).toThrow(
      /after the event starts/,
    );
  });

  it("refuses a looped event — the cut has one position per pass", () => {
    lane('  - { ref: kick, start: "1:1:1", to: "1:3:1", loop: 3 }\n');
    expect(() => splitSequenceMaterial(dir, "drums", 0, 1, NUM, DEN)).toThrow(
      /repeats 3 times/,
    );
  });

  it("answers null for an event that is not there", () => {
    expect(splitSequenceMaterial(dir, "drums", 99, 100, NUM, DEN)).toBeNull();
  });

  it("says so when the material is audio, which needs a render", () => {
    mkdirSync(join(dir, "clips"), { recursive: true });
    writeFileSync(join(dir, "clips", "riff.yaml"), "source: clips/riff.wav\n");
    lane('  - { ref: riff, start: "1:1:1" }\n');
    expect(() => splitSequenceMaterial(dir, "drums", 0, 1, NUM, DEN)).toThrow(
      /not a sequence/,
    );
  });
});

describe("selection consolidate, on sequences", () => {
  it("writes ONE sequence holding what the rectangle plays", () => {
    seq("a", "  - { t: 0, d: 1, k: 36 }\n");
    seq("b", "  - { t: 0, d: 1, k: 38 }\n");
    lane('  - { ref: a, start: "1:1:1" }\n  - { ref: b, start: "1:2:1" }\n');
    const out = consolidateSequenceMaterial(dir, "drums", 0, 4, NUM, DEN)!;
    expect(out.replaced).toBe(2);
    expect(out.from).toEqual(["a", "b"]);
    // Offsets are measured from the RECTANGLE's start, which is what makes the result play
    // where the events did.
    expect(read(out.written.file).notes).toEqual([
      { t: 0, d: 1, k: 36 },
      { t: 1, d: 1, k: 38 },
    ]);
  });

  it("keeps the GAPS — silence where nothing played", () => {
    // The whole reason the extent is the rectangle and not the notes: an event at beat 3 lands
    // at beat 3 of the new material, and the two beats before it are simply empty.
    seq("a", "  - { t: 0, d: 1, k: 36 }\n");
    lane('  - { ref: a, start: "1:4:1" }\n');
    const out = consolidateSequenceMaterial(dir, "drums", 0, 8, NUM, DEN)!;
    expect(read(out.written.file).notes).toEqual([{ t: 3, d: 1, k: 36 }]);
    // The window is the RECTANGLE, stated in full: eight beats selected, eight beats declared.
    expect(read(out.written.file).from).toBe("1:1");
    expect(read(out.written.file).to).toBe("3:1");
  });

  it("plays a note the rectangle does not reach — no extent may cut it", () => {
    // THE bug this pins, from a real project: two notes at beat 3.01 in a material selected by a
    // three-beat rectangle. The old `to: "1:4"` was beat 3, so both sat after the end — in the
    // file, and silent. Nothing about a consolidation may decide where its notes stop.
    // The report's own numbers: the pair ends exactly on beat 4.
    seq(
      "late",
      "  - { t: 3.013803, d: 0.479722, k: 47, v: 0.3228 }\n" +
        "  - { t: 3.485962, d: 0.514038, k: 46, v: 0.45 }\n",
    );
    lane('  - { ref: late, start: "1:1:1" }\n');
    const out = consolidateSequenceMaterial(dir, "drums", 0, 3, NUM, DEN)!;
    const w = read(out.written.file);
    // The rectangle is three beats and the note ends past four, so the window is WIDENED to hold
    // it: `to` was "1:4" (beat 3) and the notes sat after it, in the file and silent.
    expect(w.to).toBe("2:1");
    expect(w.notes?.[0].t).toBeCloseTo(3.013803, 6);
  });

  it("replaces every placement it consumed with one", () => {
    seq("a", "  - { t: 0, d: 1, k: 36 }\n");
    lane(
      '  - { ref: a, start: "1:1:1" }\n  - { ref: a, start: "1:2:1" }\n' +
        '  - { ref: a, start: "1:3:1" }\n',
    );
    const out = consolidateSequenceMaterial(dir, "drums", 0, 4, NUM, DEN)!;
    const ev = placements();
    expect(ev).toHaveLength(1);
    expect(ev[0].ref).toBe(out.written.ref);
    expect(ev[0].start).toBe("1:1");
  });

  it("leaves a placement OUTSIDE the rectangle alone", () => {
    seq("a", "  - { t: 0, d: 1, k: 36 }\n");
    lane('  - { ref: a, start: "1:1:1" }\n  - { ref: a, start: "3:1:1" }\n');
    consolidateSequenceMaterial(dir, "drums", 0, 4, NUM, DEN);
    const ev = placements();
    expect(ev).toHaveLength(2);
    expect(ev.some((p) => p.ref === "a" && p.start === "3:1:1")).toBe(true);
  });

  it("unrolls a repeat rather than refusing it", () => {
    // A loop is N copies of one window laid end to end, which is exactly what the consolidated
    // material has to contain.
    seq("a", "  - { t: 0, d: 1, k: 36 }\n", 'to: "1:3:1"\n');
    lane('  - { ref: a, start: "1:1:1", loop: 3 }\n');
    const out = consolidateSequenceMaterial(dir, "drums", 0, 8, NUM, DEN)!;
    expect(read(out.written.file).notes?.map((n) => n.t)).toEqual([0, 2, 4]);
  });

  it("answers null for a rectangle holding nothing", () => {
    seq("a", "  - { t: 0, d: 1, k: 36 }\n");
    lane('  - { ref: a, start: "1:1:1" }\n');
    expect(
      consolidateSequenceMaterial(dir, "drums", 40, 48, NUM, DEN),
    ).toBeNull();
  });

  it("says so when the range holds audio, which needs a render", () => {
    mkdirSync(join(dir, "clips"), { recursive: true });
    writeFileSync(join(dir, "clips", "riff.yaml"), "source: clips/riff.wav\n");
    lane('  - { ref: riff, start: "1:1:1" }\n');
    expect(() =>
      consolidateSequenceMaterial(dir, "drums", 0, 4, NUM, DEN),
    ).toThrow(/not a sequence/);
  });
});
