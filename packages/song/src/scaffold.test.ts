import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { scaffold } from "./scaffold";

// A new project is the one worked example a reader gets, and the only project pistes
// writes from scratch — so "does it load and play" is the whole contract. Nothing covered
// it while the template was CUE, which made rewriting it in YAML riskier than it needed to
// be: a mistyped field would have surfaced as an unopenable project on someone's machine.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-scaffold-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Every file under `dir`, project-relative, forward-slashed. */
const tree = (): string[] =>
  (readdirSync(dir, { recursive: true }) as unknown as string[])
    .map((f) => String(f).split("\\").join("/"))
    .sort();

describe("a scaffolded project", () => {
  it("compiles and plays, with nothing to warn about", () => {
    scaffold(dir, "demo");
    const doc = compileNodeProject(dir);
    const g = loadGraph(dir);
    expect(doc.tracks.map((t) => t.id).sort()).toEqual([
      "kit",
      "melody",
      "pad",
    ]);
    expect(Object.keys(g.chains).length).toBe(2);
    // A warning here means the template references something it didn't write.
    expect(g.warnings).toEqual([]);
    // The melody plays through the 4OSC the chain routes it into.
    const melody = doc.tracks.find((t) => t.id === "melody");
    expect(melody?.plugins.some((p) => p.type === "4osc")).toBe(true);
  });

  it("writes YAML and nothing else", () => {
    scaffold(dir, "demo");
    expect(tree().filter((f) => f.endsWith(".cue"))).toEqual([]);
    expect(tree()).toContain("project.yaml");
    expect(tree()).toContain("chains.yaml");
  });

  it("quotes the timecodes, so a placement isn't read as a number", () => {
    // `1:1:1` unquoted is a YAML 1.1 sexagesimal — the trap this format has to be written
    // around, and the reason the template states them quoted.
    scaffold(dir, "demo");
    const track = readFileSync(join(dir, "tracks", "melody.yaml"), "utf8");
    expect(track).toContain('start: "1:1:1"');
    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody?.clips?.[0]?.start).toBe(0); // bar 1 == beat 0, not 3661
  });

  it("adds picture without disturbing the audio example", () => {
    scaffold(dir, "demo", true);
    const doc = compileNodeProject(dir);
    expect(loadGraph(dir).warnings).toEqual([]);
    // The same three audio tracks, plus the two video lanes and the clip they share.
    expect(doc.tracks.map((t) => t.id).sort()).toEqual([
      "kit",
      "melody",
      "pad",
    ]);
    expect((doc.videoTracks ?? []).map((t) => t.id).sort()).toEqual([
      "main",
      "pip",
    ]);
    expect(tree()).toContain("clips/sample.mp4");
    // The pip lane starts 2s into the same source — the difference that makes the two
    // lanes show different frames.
    const pip = doc.videoTracks?.find((t) => t.id === "pip");
    expect(pip?.clips?.[0]?.sourceFrom).toBe(2);
  });

  it("names the project what it was asked to", () => {
    scaffold(dir, "my song");
    expect(compileNodeProject(dir).name).toBe("my song");
  });
});
