import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readYamlEntities } from "./loader";
import { compileNodeProject } from "./nodeProject";
import { loadAudioClipDoc } from "./project";
import { writeYaml } from "./testSupport";
import { ClipSchema } from "./yaml/entitySchemas";

// `from`/`to` window the SOURCE FILE, at TWO levels. The clip's own file carries the material's
// window — the slice it is, shared by every placement — and a placement may carry the same two
// words for ITSELF. The effective window is the most restrictive pair: the larger `from`, the
// smaller `to`. So an event can only narrow what its material plays, never reach outside it —
// which is what lets `event resize` be one event's edit (see docs/clipResize.md).
//
// Seconds in their bare-number spelling, because they measure into a file, which knows nothing
// of the tempo; a timecode spelling is musical and converted at the project's grid.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "node-demo.l8",
);

let dir: string;
const clip = (body: Record<string, unknown>) =>
  writeYaml(join(dir, "clips", "kick.yaml"), body);
// The kick's PLACEMENT, with extra fields spliced into its flow entry — the event's own window.
const place = (fields: string) =>
  writeFileSync(
    join(dir, "nodes", "drums.yaml"),
    `extends: "@studio/audio-track"\nevents:\n  - { ref: kick, start: "1:1:1"${fields} }\n  - { ref: snare, start: "2:1:1" }\n`,
    "utf8",
  );
const kick = () =>
  compileNodeProject(dir)
    .tracks.flatMap((t) => t.clips)
    .find((c) => c.name === "kick");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-cwin-"));
  cpSync(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a clip's window into its source", () => {
  it("compiles from/to onto every placement of the clip", () => {
    clip({ source: "clips/kick.wav", from: 0.25, to: 1.5 });
    expect(kick()).toMatchObject({ sourceFrom: 0.25, sourceTo: 1.5 });
  });

  it("leaves them off entirely when the clip trims nothing", () => {
    // Absent, not zero: a synthesised clip (a freeze render, a pattern's clip) has no file to be trimmed by, and
    // a doc full of zeroes would make "no window" and "a window starting at 0" the same thing to read.
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

  /**
   * The window is also the clip's EXTENT, and the doc says so in beats.
   *
   * Not just for the engine, which could measure it from the file — for the surfaces, which cannot. A doc that
   * left this at 0 gave the timeline nothing to draw with, and every audio clip in the song came out one bar
   * wide whatever it held. `to` is the only edge that decides it: an absent `from` is the file's start.
   */
  it("gives the clip its extent in beats, so the timeline can draw it", () => {
    // node-demo is 120bpm 4/4: a beat is 0.5s, so a 1.5s window is three beats.
    clip({ source: "clips/kick.wav", to: 1.5 });
    expect(kick()!.length).toBeCloseTo(3, 6);
    clip({ source: "clips/kick.wav", from: 0.5, to: 1.5 });
    expect(kick()!.length).toBeCloseTo(2, 6);
  });

  it("leaves the extent at 0 when only the FILE knows it", () => {
    // No `to` means "to the end of the source", a duration this compiler would have to open the wav to learn.
    // 0 is the engine's word for "measure it yourself", and the only honest answer here.
    clip({ source: "clips/kick.wav", from: 0.25 });
    expect(kick()!.length).toBe(0);
  });

  it("does not disturb where the placement puts it", () => {
    // The placement says only WHERE, in beats; the window says WHICH PART of the wav, in seconds. Neither is
    // expressed in the other's units, and an open-ended window leaves `length` at 0 for the engine to measure.
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
    // The snare placement carries no window, and the kick's event window is the kick's alone —
    // the material file still says nothing, so nothing else in the song changed.
    clip({ source: "clips/kick.wav" });
    place(", from: 0.25");
    const snare = compileNodeProject(dir)
      .tracks.flatMap((t) => t.clips)
      .find((c) => c.name === "snare")!;
    expect(snare.sourceFrom).toBeUndefined();
  });
});

// Every other time field in a track file is a timecode, so that is what a hand reaches for — and a take played
// to the click really does want "drop the first two bars" rather than a number of seconds nobody counted.
describe("a window written as a timecode", () => {
  /**
   * A timecode edge is a POSITION IN THE FILE, read exactly like the `start:` beside it — `"2:1"` is bar 2,
   * beat 1 of the sample, and `"1:1"` is its beginning.
   *
   * Not a duration. "2 bars and a beat IN" is a plausible reading of the same string and lands a whole bar
   * late, which is inaudible as a *kind* of error — it just sounds like the wrong take. Positions are also the
   * only reading under which a waveform's bar ruler and the number in the file agree.
   */
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

  /**
   * …and it reaches the UNPLACED doc too, but only with the grid, because that is the only thing
   * that can turn a bar number into seconds.
   *
   * This is the half that was missing. `mapClip` read `Number(c.from)`, which is `NaN` for every
   * timecode, so the definition an editor draws from came back with NO window — while the compiled
   * placement had one. An imported song writes nearly all of its edges this way, so the surfaces
   * that shade the window had nothing to shade on almost every clip in a real project.
   */
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

  // The schema runs when the folder is read, so the report names the FILE and the field — which is the whole
  // point of refusing here rather than letting it compile to a clip that plays nothing.
  it("is reported against its own file when the project is read", () => {
    clip({ source: "clips/kick.wav", from: 2, to: 1 });
    expect(readYamlEntities(dir, "clips").issues).toEqual([
      "clips/kick.yaml: to: 'to' must be greater than 'from'",
    ]);
  });

  /**
   * …and the COMPILE says the same thing, rather than "clip not found".
   *
   * A clip the schema rejects is dropped from the map, so the track's ref stops resolving and the only symptom
   * used to be `clip/sequence 'x' not found` — which sends you hunting for a file that is sitting right there,
   * with a bad line in it. Every unreadable clip behaved this way, whatever the fault.
   */
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
    expect(msg).not.toContain("not found"); // the lie it used to tell
  });
});
