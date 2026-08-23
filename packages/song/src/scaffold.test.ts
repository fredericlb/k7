import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { projectFiles, scaffold, videoProjectFiles } from "./scaffold";

// The only project st0 writes from scratch, so "does it load and play" is the whole contract.

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
    // Two lane runs plus the empty `MIX -> OUT`: the master chain's place, declared and bare.
    expect(Object.keys(g.chains).length).toBe(3);
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
    // `1:1:1` unquoted is a YAML 1.1 sexagesimal, which is why the template quotes them.
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

// The risk the pair carries is DRIFT, so `video` is pinned as `arrangement` plus picture, entry for entry.
describe("arrangement vs video", () => {
  it("gives an arrangement no picture at all — not a frame, not a shot, not the sample", () => {
    scaffold(dir, "demo");
    const files = tree();
    expect(files).toContain("surfaces/timeline.yaml");
    expect(files).not.toContain("surfaces/viewport.yaml");
    expect(files.filter((f) => f.startsWith("video_tracks/"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("clips/"))).toEqual([]);
    // `loadVideoProject` REQUIRES a viewport, so the line without a lane fails on a missing file.
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
    // Catches drift: restating an entry instead of ADDING to the song map fails on that entry.
    const audio = projectFiles("demo");
    const video = videoProjectFiles("demo");
    // The two files the picture is added INTO rather than beside; both are checked below instead.
    const merged = new Set(["project.yaml", GRAPH_FILE]);
    for (const [rel, content] of Object.entries(audio)) {
      if (merged.has(rel)) continue;
      expect(video[rel]).toBe(content);
    }
    // …and the header differs by exactly the picture block, nothing else.
    expect(video["project.yaml"].startsWith(audio["project.yaml"])).toBe(true);
    // The graph differs by a note and the run it describes; every song segment stays, in order.
    const kept = audio[GRAPH_FILE]
      .split("\n")
      .filter((l) => !l.startsWith("#"));
    const got = video[GRAPH_FILE].split("\n").filter((l) => !l.startsWith("#"));
    expect(got).toEqual([
      ...kept.slice(0, -1), // every segment the song had, MIX -> OUT included
      "  RENDER: [ VIDEO_OUT ]",
      ...kept.slice(-1), // the trailing newline the file ends on
    ]);
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
