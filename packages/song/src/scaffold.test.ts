import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { projectFiles, scaffold, videoProjectFiles } from "./scaffold";
import { wsData } from "./yaml/workspaceDoc";

// The only project k7 writes from scratch, so "does it load and play" is the whole contract.

// A workspace, since `scaffold()` now also seeds the WORKSPACE's shared synth module beside it.
let ws: string;
let dir: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-scaffold-"));
  dir = join(ws, "song.k7");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

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

  it("is born a CHAIN project, the main layout: chain files and lanes, no graph and no node files", () => {
    const written = scaffold(dir, "demo");
    expect(tree().filter((f) => f.endsWith(".cue"))).toEqual([]);
    expect(tree()).toContain("project.k7x");
    expect(
      tree().filter((f) => f.startsWith("chains/")).length,
    ).toBeGreaterThan(0);
    expect(tree()).toContain("tracks/melody.k7x");
    expect(tree()).not.toContain(GRAPH_FILE);
    expect(tree().filter((f) => f.startsWith("nodes/"))).toEqual([]);
    // No workspace file is YAML any more.
    expect(tree().filter((f) => /\.ya?ml$/.test(f))).toEqual([]);
    // What it says it wrote is what is there.
    expect([...written].sort()).toEqual(tree().filter((f) => f.includes(".")));
  });

  it("places the melody at bar 1, which is beat 0", () => {
    scaffold(dir, "demo");
    expect(wsData(join(dir, "tracks", "melody.k7x")).events).toEqual([
      { ref: "melody", start: "1:1:1" },
    ]);
    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody?.clips?.[0]?.start).toBe(0);
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
    expect(files).toContain("surfaces/timeline.k7x");
    expect(files).not.toContain("surfaces/viewport.k7x");
    expect(files.filter((f) => f.startsWith("video_tracks/"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("clips/"))).toEqual([]);
    // `loadVideoProject` REQUIRES a viewport, so the line without a lane fails on a missing file.
    expect(
      (wsData(join(dir, "project.k7x")).project as Record<string, unknown>)
        .viewport,
    ).toBeUndefined();
  });

  it("gives video the arrangement plus picture, sharing every other file", () => {
    scaffold(dir, "demo", "video");
    const files = tree();
    for (const f of [
      "surfaces/timeline.k7x",
      "surfaces/viewport.k7x",
      "video_tracks/main.k7x",
      "clips/sample.k7x",
      "clips/sample.mp4", // COPIED, not referenced where the package sits
    ])
      expect(files).toContain(f);
    expect(
      (wsData(join(dir, "project.k7x")).project as Record<string, unknown>)
        .viewport,
    ).toEqual([1280, 720, 30]);
  });

  it("keeps the shared half identical, byte for byte", () => {
    // Catches drift: restating an entry instead of ADDING to the song map fails on that entry.
    const audio = projectFiles("demo");
    const video = videoProjectFiles("demo");
    // The two files the picture is added INTO rather than beside; both are checked below instead.
    const merged = new Set(["project.k7x", GRAPH_FILE]);
    for (const [rel, content] of Object.entries(audio)) {
      if (merged.has(rel)) continue;
      expect(video[rel]).toBe(content);
    }
    // …and the header differs by exactly the picture fields, nothing else.
    const a = parse(audio["project.k7x"]);
    const v = parse(video["project.k7x"]);
    expect(v).toEqual({
      ...a,
      project: {
        ...(a.project as object),
        viewport: [1280, 720, 30],
        layers: ["main"],
      },
    });
    // The graph differs by the run the picture adds; every song segment stays, in order.
    const kept = parse(audio[GRAPH_FILE]).modules as Record<string, string[]>;
    expect(parse(video[GRAPH_FILE]).modules).toEqual({
      ...kept,
      RENDER: ["VIDEO_OUT"],
    });
    expect(
      Object.keys(parse(video[GRAPH_FILE]).modules as object).slice(0, -1),
    ).toEqual(Object.keys(kept));
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
