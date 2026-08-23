// The picture's two built-in outputs: that the run is DERIVED and validated like the sound's,
// and — the half that has no audio equivalent — that a project declaring a viewport gains the
// line without anyone asking for it, without losing the comments around it.
// See docs/videoOutputs.md.

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
import { deriveChains } from "./chainsGraph";
import { loadGraph, validate } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { scaffold } from "./scaffold";
import { createSurfaceFile } from "./surfaces";
import { writeLane, writeModule } from "./testSupport";
import { addVideoRun, ensureVideoRun, hasVideoRun } from "./videoOutputs";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "video-outputs-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A project folder with a graph, and optionally a viewport surface. */
function project(graph: string, viewport = true): string {
  const dir = join(root, "song.st0");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
  );
  writeFileSync(join(dir, "graph.yaml"), graph, "utf8");
  if (viewport) {
    mkdirSync(join(dir, "surfaces"), { recursive: true });
    writeFileSync(
      join(dir, "surfaces", "viewport.yaml"),
      "type: viewport\nlayout: split\n",
    );
  }
  return dir;
}

const read = (dir: string) => readFileSync(join(dir, "graph.yaml"), "utf8");

describe("the run itself", () => {
  it("derives a chain named after the sum, the way MIX does", () => {
    // RENDER has to be a "lane" in the derivation or the run headed by it is indistinguishable
    // from an ordinary bus — and, worse, the last video chain to arrive absorbs it.
    const chains = deriveChains({
      modules: { blur: ["VIDEO_OUT"], RENDER: ["blur"] },
    });
    expect(chains.RENDER?.from).toBe("RENDER");
    expect(chains.RENDER?.use.map((s) => s.module)).toEqual(["blur"]);
    expect(chains.RENDER?.out.map((o) => o.to)).toEqual(["VIDEO_OUT"]);
  });

  it("is not absorbed by the video lane that feeds it", () => {
    // The trap MIX was given lane status for: every lane feeds the sum, so without it the last
    // one to arrive swallows the whole master run as its own next steps.
    const chains = deriveChains(
      { modules: { main: ["RENDER"], RENDER: ["VIDEO_OUT"] } },
      (n) => n === "main",
    );
    expect(chains.main?.use).toEqual([]);
    expect(chains.RENDER?.from).toBe("RENDER");
  });

  it("does not warn that RENDER is neither a track nor a chain", () => {
    // The exact failure MIX had: the line is written onto every project with a viewport, so
    // leaving the exemption out would warn on all of them at once.
    const dir = project("modules:\n  RENDER: [ VIDEO_OUT ]\n");
    expect(validate(loadGraph(dir))).toEqual([]);
  });

  it("is a SINK, so a run ending at VIDEO_OUT is not read as a bus", () => {
    const dir = project("modules:\n  RENDER: [ VIDEO_OUT ]\n");
    expect(
      validate(loadGraph(dir)).filter((w) => w.includes("VIDEO_OUT")),
    ).toEqual([]);
  });

  it("compiles to NOTHING, and changes no audio document", () => {
    // The honest state today: VideoPluginDoc is modelled and nothing bakes it, so the video run
    // has no owner and its steps drop. Pinned so the day it DOES compile, this test says so.
    const dir = join(root, "compiled.st0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "project.yaml"),
      "project:\n  name: t\n  tempo: 120\n",
    );
    writeModule(dir, "audio", "amp", {
      plugin: { type: "internal", name: "Chorus" },
    });
    writeLane(dir, "gtr");
    const base = "modules:\n  gtr: [ amp ]\n  amp: [ MIX ]\n  MIX: [ OUT ]\n";
    writeFileSync(join(dir, "graph.yaml"), base, "utf8");
    const without = compileNodeProject(dir);
    writeFileSync(
      join(dir, "graph.yaml"),
      `${base}  RENDER: [ VIDEO_OUT ]\n`,
      "utf8",
    );
    expect(compileNodeProject(dir)).toEqual(without);
  });
});

describe("hasVideoRun", () => {
  it("wants the KEY, not a destination naming it", () => {
    // `main: [ RENDER ]` names the sum without saying where the sum goes — that project still
    // needs the line.
    expect(hasVideoRun("modules:\n  main: [ RENDER ]\n")).toBe(false);
    expect(hasVideoRun("modules:\n  RENDER: [ VIDEO_OUT ]\n")).toBe(true);
  });
});

describe("addVideoRun", () => {
  it("appends to the end of the modules map, keeping every comment", () => {
    const text =
      "# the graph\nmodules:\n  # the lane\n  gtr: [ MIX ]\n  MIX: [ OUT ]\n";
    expect(addVideoRun(text)).toBe(
      "# the graph\nmodules:\n  # the lane\n  gtr: [ MIX ]\n  MIX: [ OUT ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
  });

  it("steps over a blank line inside the map, and stops at the next unindented key", () => {
    const text =
      "modules:\n  gtr: [ MIX ]\n\n  MIX: [ OUT ]\n\nbypassed: [ gtr ]\n";
    expect(addVideoRun(text)).toBe(
      "modules:\n  gtr: [ MIX ]\n\n  MIX: [ OUT ]\n  RENDER: [ VIDEO_OUT ]\n\nbypassed: [ gtr ]\n",
    );
  });

  it("refuses a graph with no modules map rather than inventing one", () => {
    expect(addVideoRun("bypassed: [ gtr ]\n")).toBeNull();
  });
});

describe("ensureVideoRun", () => {
  it("adds the run and reports that it wrote", () => {
    const dir = project("modules:\n  gtr: [ MIX ]\n  MIX: [ OUT ]\n");
    expect(ensureVideoRun(dir)).toBe(true);
    expect(read(dir)).toContain("  RENDER: [ VIDEO_OUT ]");
  });

  it("is idempotent — a second open changes nothing", () => {
    const dir = project("modules:\n  gtr: [ MIX ]\n  MIX: [ OUT ]\n");
    ensureVideoRun(dir);
    const after = read(dir);
    expect(ensureVideoRun(dir)).toBe(false);
    expect(read(dir)).toBe(after);
  });

  it("leaves a graph with no modules map alone rather than failing to open", () => {
    const dir = project("bypassed: [ gtr ]\n");
    expect(ensureVideoRun(dir)).toBe(false);
    expect(read(dir)).toBe("bypassed: [ gtr ]\n");
  });

  it("says false for a project with no graph at all", () => {
    const dir = join(root, "bare.st0");
    mkdirSync(dir, { recursive: true });
    expect(ensureVideoRun(dir)).toBe(false);
  });
});

describe("where it is added from", () => {
  it("`project surface new viewport` brings the pair with it", () => {
    // The surface and its outputs in one breath: the command reads back a project whose frame
    // has somewhere to leave by, rather than one a later open will fix.
    const dir = project("modules:\n  gtr: [ MIX ]\n  MIX: [ OUT ]\n", false);
    createSurfaceFile(dir, "viewport");
    expect(read(dir)).toContain("  RENDER: [ VIDEO_OUT ]");
  });

  it("a timeline surface brings NOTHING — a song with no picture never sees the names", () => {
    const dir = project("modules:\n  gtr: [ MIX ]\n  MIX: [ OUT ]\n", false);
    createSurfaceFile(dir, "timeline");
    expect(read(dir)).not.toContain("RENDER");
  });

  it("the `video` archetype is born with it, and `arrangement` is not", () => {
    const vid = join(root, "vid.st0");
    mkdirSync(vid, { recursive: true });
    scaffold(vid, "vid", "video");
    expect(read(vid)).toContain("  RENDER: [ VIDEO_OUT ]");
    // …and the note above the map, which is this repo's half of the job: the splice writes a
    // line, not a reason.
    expect(read(vid)).toContain("videoOutputs.md");

    const arr = join(root, "arr.st0");
    mkdirSync(arr, { recursive: true });
    scaffold(arr, "arr");
    expect(read(arr)).not.toContain("RENDER");
  });

  it("the scaffolded video graph still parses, and still declares the audio run", () => {
    // The archetype ADDS to the song's map rather than restating it, so the thing worth pinning
    // is that the sound's run survived the splice that added the picture's.
    const vid = join(root, "both.st0");
    mkdirSync(vid, { recursive: true });
    scaffold(vid, "both", "video");
    const g = loadGraph(vid);
    expect(g.chains.MIX?.out.map((o) => o.to)).toEqual(["OUT"]);
    expect(g.chains.RENDER?.out.map((o) => o.to)).toEqual(["VIDEO_OUT"]);
    expect(validate(g)).toEqual([]);
  });
});
