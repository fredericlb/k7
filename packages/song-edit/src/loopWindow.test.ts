import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNodeProject } from "@studio/song/nodeProject";
import { writeYaml } from "@studio/song/testSupport";
import { PlacementSchema } from "@studio/song-schema/yaml/placementSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materialWindow } from "./materialWindow";

// The model these exercise: the MATERIAL owns its window, the PLACEMENT its `start` and `loop`.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
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
    extends: "@studio/track",
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
    // Otherwise a pattern ending a sixteenth before the barline drifts by one on every repeat.
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
    // A MIDI clip ignores `offset`, so the loop range is the only thing that can say "start at bar 2".
    seq({ from: "2:1", to: "3:1" });
    place({});
    const c = melody();
    expect(c.length).toBe(4);
    expect(c.loopStart).toBe(4);
    expect(c.loopEnd).toBe(8);
  });

  it("writes no loop range for a single pass from the beginning", () => {
    // Nothing to say: `to: "3:1"` is exactly where these eight notes already end.
    seq({ to: "3:1" });
    place({});
    expect(melody()).toMatchObject({ length: 8, loopStart: 0, loopEnd: 0 });
  });

  /** …but a `to` that does NOT land on the notes says something they do not, so it is written. */
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
    // The default `to` IS the extent, so this must not become "every sequence carries a range".
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

  /** An audio clip with no `to` has no number to multiply, so N passes are refused rather than dropped. */
  it("is refused on an audio clip whose window has no end", () => {
    writeYaml(join(dir, "clips", "riff.yaml"), { source: "clips/riff.wav" });
    writeYaml(join(dir, "nodes", "riff.yaml"), {
      extends: "@studio/track",
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

/** The rule turning a foreign DAW's geometry into this model, shared by the importer and the migration. */
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
    // Real material: 24 beats against a 26.38-beat region that never comes round, so it was a bound.
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
