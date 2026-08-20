import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { projectFiles, scaffold, videoProjectFiles } from "./scaffold";

// A new project is the one worked example a reader gets, and the only project st0
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
    expect(tree()).toContain("graph.yaml");
  });

  it("quotes the timecodes, so a placement isn't read as a number", () => {
    // `1:1:1` unquoted is a YAML 1.1 sexagesimal — the trap this format has to be written
    // around, and the reason the template states them quoted.
    scaffold(dir, "demo");
    const track = readFileSync(join(dir, "nodes", "melody.yaml"), "utf8");
    expect(track).toContain('start: "1:1:1"');
    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody?.clips?.[0]?.start).toBe(0); // bar 1 == beat 0, not 3661
  });

  it("names the project what it was asked to", () => {
    scaffold(dir, "my song");
    expect(compileNodeProject(dir).name).toBe("my song");
  });
});

// The two timeline archetypes, and the line between them. `arrangement` is the sound; `video` is
// the same sound plus a frame to composite into. The risk the pair carries is DRIFT — a fix made
// to one map and not the other — so what is pinned here is that the second is the first plus
// picture, entry for entry, rather than a second copy that happens to agree today.
describe("arrangement vs video", () => {
  it("gives an arrangement no picture at all — not a frame, not a shot, not the sample", () => {
    scaffold(dir, "demo");
    const files = tree();
    expect(files).toContain("surfaces/timeline.yaml");
    expect(files).not.toContain("surfaces/viewport.yaml");
    expect(files.filter((f) => f.startsWith("video_tracks/"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("clips/"))).toEqual([]);
    // And nothing in the header promising one: `loadVideoProject` REQUIRES a viewport, so a
    // project carrying the line but no lane would fail on a file it never wrote.
    expect(readFileSync(join(dir, "project.yaml"), "utf8")).not.toContain(
      "viewport:",
    );
  });

  it("gives video the arrangement plus picture, sharing every other file", () => {
    scaffold(dir, "demo", "video");
    const files = tree();
    for (const f of [
      "surfaces/timeline.yaml",
      "surfaces/viewport.yaml",
      "video_tracks/main.yaml",
      "clips/sample.yaml",
      "clips/sample.mp4", // COPIED, not referenced where the package sits
    ])
      expect(files).toContain(f);
    expect(readFileSync(join(dir, "project.yaml"), "utf8")).toContain(
      "viewport: [1280, 720, 30]",
    );
  });

  it("keeps the shared half identical, byte for byte", () => {
    // The one that catches drift: `videoProjectFiles` is built by ADDING to the song map, and a
    // day someone restates an entry instead, this fails on that entry rather than on a symptom
    // a project only shows once it is opened.
    const audio = projectFiles("demo");
    const video = videoProjectFiles("demo");
    for (const [rel, content] of Object.entries(audio)) {
      if (rel === "project.yaml") continue; // the viewport lines live INSIDE the header
      expect(video[rel]).toBe(content);
    }
    // …and the header differs by exactly the picture block, nothing else.
    expect(video["project.yaml"].startsWith(audio["project.yaml"])).toBe(true);
  });

  it("still plays, with picture on top of the same worked example", () => {
    scaffold(dir, "demo", "video");
    const doc = compileNodeProject(dir);
    expect(doc.tracks.map((t) => t.id).sort()).toEqual([
      "kit",
      "melody",
      "pad",
    ]);
    expect(loadGraph(dir).warnings).toEqual([]);
  });
});
