import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materialWindow } from "./materialWindow";
import { compileNodeProject } from "./nodeProject";
import { writeYaml } from "./testSupport";
import { PlacementSchema } from "./yaml/placementSchema";

// The model these exercise: the MATERIAL owns its window (`from`/`to`, in the clip's or the sequence's own file)
// and the PLACEMENT owns where it goes and how many times it is played (`start`, `loop`). A placement has no
// length of its own — the extent is derived, N × the window — so the two can never disagree about it.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);

let dir: string;
// synth-demo is 120bpm 4/4 and places sequences/melody.yaml (8 notes, one per beat) at bar 1.
const seq = (body: Record<string, unknown>) =>
  writeYaml(join(dir, "sequences", "melody.yaml"), {
    notes: Array.from({ length: 8 }, (_, i) => ({ t: i, d: 1, k: 60 + i })),
    ...body,
  });
const place = (p: Record<string, unknown>) =>
  writeYaml(join(dir, "nodes", "melody.yaml"), {
    extends: "@studio/sequence-track",
    events: [{ ref: "melody", start: "1:1:1", ...p }],
  });
const melody = () =>
  compileNodeProject(dir)
    .tracks.flatMap((t) => t.clips)
    .find((c) => c.name === "melody")!;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-loop-"));
  cpSync(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a sequence's window into its own notes", () => {
  it("is the notes themselves when the file says nothing", () => {
    place({});
    expect(melody().length).toBe(8); // eight beats of notes
  });

  it("rounds that default UP TO THE BAR", () => {
    // Otherwise a pattern whose last hit is a sixteenth before the barline is 3.75 beats long, and every repeat
    // of it drifts by a sixteenth. Material is written in bars; a sequence that means otherwise says `to`.
    seq({ notes: [{ t: 0, d: 0.25, k: 60 }] });
    place({});
    expect(melody().length).toBe(4);
  });

  it("takes `to` over the notes, longer OR shorter than them", () => {
    seq({ to: "5:1" }); // bar 5 beat 1 == 16 beats in
    place({});
    expect(melody().length).toBe(16);
    seq({ to: "2:1" });
    expect(melody().length).toBe(4);
  });

  it("reads `from` as a POSITION, and hands it to the engine as a loop range", () => {
    // A MIDI clip ignores `offset` (see insertMidiClip), so the loop range is the only thing that can say
    // "start at bar 2" — and it is what carries the window whenever the window doesn't start at the beginning.
    seq({ from: "2:1", to: "3:1" });
    place({});
    const c = melody();
    expect(c.length).toBe(4);
    expect(c.loopStart).toBe(4);
    expect(c.loopEnd).toBe(8);
  });

  it("writes no loop range for a single pass from the beginning", () => {
    // Nothing to say: `to: "3:1"` is exactly where these eight notes already end, so the range would repeat the
    // notes back at themselves. A loop that must never come round is one more thing to be slightly wrong about.
    seq({ to: "3:1" });
    place({});
    expect(melody()).toMatchObject({ length: 8, loopStart: 0, loopEnd: 0 });
  });

  /**
   * …but a `to` that does NOT land on the notes says something they do not, and it is written even for one pass
   * from the beginning. This is what a surface reads to shade the window, and without it the case commonest in a
   * hand-written file — trim the tail, play it once — reached the roll and the tracker as nothing at all.
   */
  it("writes one for a `to` that CUTS the notes short", () => {
    seq({ to: "2:1" }); // 4 beats of the 8 the notes cover
    place({});
    expect(melody()).toMatchObject({ length: 4, loopStart: 0, loopEnd: 4 });
  });

  it("writes one for a `to` that PADS past the last note", () => {
    // The silence after the material is deliberate, and the only thing that says so is this pair.
    seq({ to: "5:1" }); // 16 beats against 8 of notes
    place({});
    expect(melody()).toMatchObject({ length: 16, loopStart: 0, loopEnd: 16 });
  });

  it("still writes none when the file states no window at all", () => {
    // The default `to` IS the extent, so this must not become "every sequence carries a range" — a roll that
    // banded every clip in the project with the whole of itself would be saying nothing, loudly.
    place({});
    expect(melody()).toMatchObject({ length: 8, loopStart: 0, loopEnd: 0 });
  });
});

describe("`loop` counts passes of that window", () => {
  it("multiplies the extent, and repeats the window itself", () => {
    seq({ to: "3:1" }); // an 8-beat window
    place({ loop: 3 });
    expect(melody()).toMatchObject({ length: 24, loopStart: 0, loopEnd: 8 });
  });

  it("counts from a windowed start too", () => {
    seq({ from: "2:1", to: "3:1" });
    place({ loop: 4 });
    expect(melody()).toMatchObject({ length: 16, loopStart: 4, loopEnd: 8 });
  });

  it("is a count, not a pair of timecodes", () => {
    expect(PlacementSchema.safeParse({ ref: "m", loop: 4 }).success).toBe(true);
    expect(PlacementSchema.safeParse({ ref: "m", loop: 0 }).success).toBe(
      false,
    );
    expect(PlacementSchema.safeParse({ ref: "m", loop: 2.5 }).success).toBe(
      false,
    );
    expect(
      PlacementSchema.safeParse({ ref: "m", loop: ["1:1", "2:1"] }).success,
    ).toBe(false);
  });

  it("no longer takes a length or an offset — the material says how long it is", () => {
    for (const bad of [{ length: "4:0:0" }, { offset: "1:0:0" }])
      expect(PlacementSchema.safeParse({ ref: "m", ...bad }).success).toBe(
        false,
      );
  });

  /**
   * An audio clip with no `to` ends where its FILE ends, which only the engine knows — so `length` stays 0 and
   * the engine measures it. That works for one pass and cannot work for N: there is no number here to multiply.
   * Refusing beats playing the first pass and silently dropping the rest.
   */
  it("is refused on an audio clip whose window has no end", () => {
    writeYaml(join(dir, "clips", "riff.yaml"), { source: "clips/riff.wav" });
    writeYaml(join(dir, "nodes", "riff.yaml"), {
      extends: "@studio/audio-track",
      events: [{ ref: "riff", start: "1:1:1", loop: 2 }],
    });
    let msg = "";
    try {
      compileNodeProject(dir);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("loop: 2");
    expect(msg).toContain("no 'to'");
  });
});

/**
 * The rule that turns a foreign DAW's geometry into this model, shared by the importer and by the migration so
 * both land on the same numbers. Everything in beats.
 */
describe("reading a window out of a DAW's (length, offset, loop region)", () => {
  it("recognises a whole number of loops, and counts them", () => {
    expect(materialWindow({ length: 32, loopStart: 0, loopEnd: 8 })).toEqual({
      from: 0,
      to: 8,
      loops: 4,
    });
  });

  it("keeps a loop region that does not start at zero", () => {
    expect(materialWindow({ length: 24, loopStart: 4, loopEnd: 12 })).toEqual({
      from: 4,
      to: 12,
      loops: 3,
    });
  });

  it("treats a length SHORTER than its region as one truncated pass", () => {
    // Real material: LEMO - DANSE's two wurli takes are 24 beats against a 26.38-beat region. They never come
    // round, so the region was only ever a bound — one pass of a 24-beat window says the same thing exactly.
    expect(
      materialWindow({ length: 24, loopStart: 0, loopEnd: 26.38 }),
    ).toEqual({ from: 0, to: 24, loops: 1 });
  });

  it("cuts a ragged multiple down to one pass rather than rounding it", () => {
    expect(materialWindow({ length: 20, loopStart: 0, loopEnd: 8 })).toEqual({
      from: 0,
      to: 20,
      loops: 1,
    });
  });

  it("makes an unlooped clip a single pass from its in-point", () => {
    expect(materialWindow({ length: 8, offset: 0.5 })).toEqual({
      from: 0.5,
      to: 8.5,
      loops: 1,
    });
  });

  it("absorbs the rounding an import leaves behind", () => {
    // 26.38 is a decimal an exporter wrote; 8 × it is not exactly 211.04 in binary floating point.
    const w = materialWindow({
      length: 26.38 * 8,
      loopStart: 0,
      loopEnd: 26.38,
    });
    expect(w.loops).toBe(8);
    expect(w.to).toBe(26.38);
  });
});
