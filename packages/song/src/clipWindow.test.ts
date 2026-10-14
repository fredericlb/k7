import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClipSchema } from "@studio/song-schema/yaml/entitySchemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readYamlEntities } from "./loader";
import { compileNodeProject } from "./nodeProject";
import { loadAudioClipDoc } from "./project";
import { copyAsYaml, writeYaml } from "./testSupport";

// `from`/`to` window the SOURCE FILE at two levels, and the effective pair is the most restrictive.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "node-demo.st0");

let dir: string;
const clip = (body: Record<string, unknown>) =>
  writeYaml(join(dir, "clips", "kick.yaml"), body);
// The kick's PLACEMENT, with extra fields spliced into its flow entry — the event's own window.
const place = (fields: string) =>
  writeFileSync(
    join(dir, "nodes", "drums.yaml"),
    `extends: "@meta/track"\nevents:\n  - { ref: kick, start: "1:1:1"${fields} }\n  - { ref: snare, start: "2:1:1" }\n`,
    "utf8",
  );
const kick = () =>
  compileNodeProject(dir)
    .tracks.flatMap((t) => t.clips)
    .find((c) => c.name === "kick");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-cwin-"));
  copyAsYaml(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a clip's window into its source", () => {
  it("compiles from/to onto every placement of the clip", () => {
    clip({ source: "clips/kick.wav", from: 0.25, to: 1.5 });
    expect(kick()).toMatchObject({ sourceFrom: 0.25, sourceTo: 1.5 });
  });

  it("leaves them off entirely when the clip trims nothing", () => {
    // Absent, not zero: zeroes make "no window" and "a window starting at 0" read the same.
    clip({ source: "clips/kick.wav" });
    const c = kick()!;
    expect(c.sourceFrom).toBeUndefined();
    expect(c.sourceTo).toBeUndefined();
  });

  it("takes just one edge", () => {
    clip({ source: "clips/kick.wav", from: 0.1 });
    expect(kick()).toMatchObject({ sourceFrom: 0.1 });
    expect(kick()!.sourceTo).toBeUndefined();
  });

  it("reaches the UNPLACED clip doc too — what the editor draws its waveform from", () => {
    clip({ source: "clips/kick.wav", from: 0.25, to: 1.5 });
    expect(loadAudioClipDoc(dir, "kick")).toMatchObject({
      sourceFrom: 0.25,
      sourceTo: 1.5,
    });
  });

  /** The extent in beats is for the SURFACES: left at 0, every audio clip drew one bar wide. */
  it("gives the clip its extent in beats, so the timeline can draw it", () => {
    // node-demo is 120bpm 4/4: a beat is 0.5s, so a 1.5s window is three beats.
    clip({ source: "clips/kick.wav", to: 1.5 });
    expect(kick()!.length).toBeCloseTo(3, 6);
    clip({ source: "clips/kick.wav", from: 0.5, to: 1.5 });
    expect(kick()!.length).toBeCloseTo(2, 6);
  });

  it("leaves the extent at 0 when only the FILE knows it", () => {
    // 0 is the engine's word for "measure it yourself", which is the only honest answer here.
    clip({ source: "clips/kick.wav", from: 0.25 });
    expect(kick()!.length).toBe(0);
  });

  it("does not disturb where the placement puts it", () => {
    // The placement says WHERE in beats and the window WHICH PART in seconds: two units, never mixed.
    clip({ source: "clips/kick.wav", from: 0.25 });
    const c = kick()!;
    expect(c.start).toBe(0);
    expect(c.length).toBe(0);
    expect(c.offset).toBe(0);
  });
});

describe("the EVENT's own window, on the placement", () => {
  it("windows the placement when the clip states none", () => {
    clip({ source: "clips/kick.wav" });
    place(", from: 0.25, to: 1.5");
    expect(kick()).toMatchObject({ sourceFrom: 0.25, sourceTo: 1.5 });
    // …and gives the event its extent: 1.25 s is 2.5 beats at 120bpm.
    expect(kick()!.length).toBeCloseTo(2.5, 6);
  });

  it("intersects with the clip's — the most restrictive edge wins", () => {
    // Clip 0.5 → 1.25; event 0.25 → 1.5 asks for more on both sides and gets none of it.
    clip({ source: "clips/kick.wav", from: 0.5, to: 1.25 });
    place(", from: 0.25, to: 1.5");
    expect(kick()).toMatchObject({ sourceFrom: 0.5, sourceTo: 1.25 });
    // The other way round, the event is the narrow one and wins both edges.
    clip({ source: "clips/kick.wav", from: 0.25, to: 1.5 });
    place(", from: 0.5, to: 1.25");
    expect(kick()).toMatchObject({ sourceFrom: 0.5, sourceTo: 1.25 });
  });

  it("narrows ONE edge while the clip keeps the other", () => {
    clip({ source: "clips/kick.wav", from: 0.25, to: 1.5 });
    place(", to: 1");
    expect(kick()).toMatchObject({ sourceFrom: 0.25, sourceTo: 1 });
  });

  it("reads a timecode edge like the clip's own", () => {
    clip({ source: "clips/kick.wav" });
    place(', from: "2:1"'); // bar 2 beat 1 of the file = 2 s at 120bpm 4/4
    expect(kick()!.sourceFrom).toBeCloseTo(2, 6);
  });

  it("does not reach the OTHER placements of the clip", () => {
    // An event's window is that event's alone: the material file still says nothing.
    clip({ source: "clips/kick.wav" });
    place(", from: 0.25");
    const snare = compileNodeProject(dir)
      .tracks.flatMap((t) => t.clips)
      .find((c) => c.name === "snare")!;
    expect(snare.sourceFrom).toBeUndefined();
  });
});

// Every other time field in a track file is a timecode, so that is what a hand reaches for.
describe("a window written as a timecode", () => {
  /** A timecode edge is a POSITION in the file, not a duration: reading it as one lands a bar late. */
  it("reads as a POSITION in the file, like `start:` does", () => {
    // node-demo is 120bpm 4/4: a beat is 0.5s, a bar 2s. Bar 2 beat 1 is 4 beats in = 2s.
    clip({ source: "clips/kick.wav", from: "2:1" });
    expect(kick()!.sourceFrom).toBeCloseTo(2, 6);
  });

  it("puts `1:1` at the file's very start, not one bar in", () => {
    clip({ source: "clips/kick.wav", from: "1:1" });
    // Position 1:1 is zero beats in, so it trims nothing — and an edge worth nothing is left off entirely.
    expect(kick()!.sourceFrom).toBeUndefined();
  });

  it("mixes with seconds — the spelling picks the unit, per edge", () => {
    clip({ source: "clips/kick.wav", from: 0.5, to: "2:1" });
    const c = kick()!;
    expect(c.sourceFrom).toBeCloseTo(0.5, 6); // a number is already seconds
    expect(c.sourceTo).toBeCloseTo(2, 6); // bar 2 beat 1
  });

  it("still leaves an unwritten edge absent", () => {
    clip({ source: "clips/kick.wav", from: "2:1" });
    expect(kick()!.sourceTo).toBeUndefined();
  });

  /** `mapClip` must parse the grid, not `Number(c.from)`: that is `NaN` for every timecode, so no window. */
  it("reaches the UNPLACED clip doc, given the project's grid", () => {
    clip({ source: "clips/kick.wav", from: "2:1", to: "3:1" });
    const c = loadAudioClipDoc(dir, "kick", { tempo: 120, num: 4, den: 4 })!;
    expect(c.sourceFrom).toBeCloseTo(2, 6); // bar 2 beat 1 == 4 beats == 2s at 120bpm
    expect(c.sourceTo).toBeCloseTo(4, 6);
  });

  it("drops a timecode edge with no grid rather than guessing at one", () => {
    clip({ source: "clips/kick.wav", from: "2:1", to: "3:1" });
    const c = loadAudioClipDoc(dir, "kick")!;
    expect(c.sourceFrom).toBeUndefined();
    expect(c.sourceTo).toBeUndefined();
  });

  it("still reads SECONDS with no grid, as every caller of this always could", () => {
    clip({ source: "clips/kick.wav", from: 0.25, to: 1.5 });
    expect(loadAudioClipDoc(dir, "kick")).toMatchObject({
      sourceFrom: 0.25,
      sourceTo: 1.5,
    });
  });
});

describe("a window that cannot be played", () => {
  it("is refused by the schema, naming the field", () => {
    const bad = ClipSchema.safeParse({
      source: "clips/kick.wav",
      from: 2,
      to: 1,
    });
    expect(bad.success).toBe(false);
  });

  it("refuses a negative `from`", () => {
    expect(
      ClipSchema.safeParse({ source: "clips/kick.wav", from: -1 }).success,
    ).toBe(false);
  });

  it("accepts a window with only one edge, or none", () => {
    for (const c of [
      { source: "clips/kick.wav" },
      { source: "clips/kick.wav", from: 0.5 },
      { source: "clips/kick.wav", to: 0.5 },
    ])
      expect(ClipSchema.safeParse(c).success).toBe(true);
  });

  // The schema runs when the folder is read, so the report names the FILE and the field.
  it("is reported against its own file when the project is read", () => {
    clip({ source: "clips/kick.wav", from: 2, to: 1 });
    expect(readYamlEntities(dir, "clips").issues).toEqual([
      "clips/kick.yaml: to: 'to' must be greater than 'from'",
    ]);
  });

  /** A rejected clip leaves the map, so the compile must not say "not found" about a file that is there. */
  it("does not masquerade as a missing clip", () => {
    clip({ source: "clips/kick.wav", from: "nonsense" });
    let msg = "";
    try {
      compileNodeProject(dir);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("failed to load");
    expect(msg).toContain("clips/kick.yaml"); // the file to open
    expect(msg).not.toContain("not found"); // the lie to avoid
  });
});
