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
import { K7Document } from "@studio/k7x/document";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readChainProject } from "./chainProject";
import { deriveChains } from "./chainsGraph";
import { loadGraph, validate } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { scaffold } from "./scaffold";
import { createSurfaceFile } from "./surfaces";
import { writeDoc, writeLane, writeModule } from "./testSupport";
import { addVideoRun, ensureVideoRun, hasVideoRun } from "./videoOutputs";
import { wsData } from "./yaml/workspaceDoc";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "video-outputs-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const PLAIN = 'modules({ gtr: ["MIX"], MIX: ["OUT"] })\n';
const RENDER_ONLY = 'modules({ RENDER: ["VIDEO_OUT"] })\n';

/** A project folder with a graph given as k7x text, and optionally a viewport surface. */
function project(graph: string, viewport = true): string {
  const dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeFileSync(join(dir, "graph.k7x"), graph, "utf8");
  if (viewport)
    writeDoc(join(dir, "surfaces", "viewport.k7x"), {
      type: "viewport",
      layout: "floating",
    });
  return dir;
}

const read = (dir: string) => readFileSync(join(dir, "graph.k7x"), "utf8");
const modulesOf = (dir: string) =>
  wsData(join(dir, "graph.k7x")).modules as Record<string, string[]>;

/** `addVideoRun` on a whole k7x text: the new text, or null when it refused. */
const added = (text: string): string | null => {
  const doc = new K7Document(text);
  return addVideoRun(doc.at([])) ? doc.toString() : null;
};

describe("the run itself", () => {
  it("derives a chain named after the sum, the way MIX does", () => {
    // RENDER must be a "lane" or its run reads as an ordinary bus and gets absorbed.
    const chains = deriveChains({
      modules: { blur: ["VIDEO_OUT"], RENDER: ["blur"] },
    });
    expect(chains.RENDER?.from).toBe("RENDER");
    expect(chains.RENDER?.use.map((s) => s.module)).toEqual(["blur"]);
    expect(chains.RENDER?.out.map((o) => o.to)).toEqual(["VIDEO_OUT"]);
  });

  it("is not absorbed by the video lane that feeds it", () => {
    // The trap MIX has lane status for: the last lane to arrive swallows the whole master run.
    const chains = deriveChains(
      { modules: { main: ["RENDER"], RENDER: ["VIDEO_OUT"] } },
      (n) => n === "main",
    );
    expect(chains.main?.use).toEqual([]);
    expect(chains.RENDER?.from).toBe("RENDER");
  });

  it("does not warn that RENDER is neither a track nor a chain", () => {
    // The line is written onto every project with a viewport, so a missing exemption warns on all.
    const dir = project(RENDER_ONLY);
    expect(validate(loadGraph(dir))).toEqual([]);
  });

  it("is a SINK, so a run ending at VIDEO_OUT is not read as a bus", () => {
    const dir = project(RENDER_ONLY);
    expect(
      validate(loadGraph(dir)).filter((w) => w.includes("VIDEO_OUT")),
    ).toEqual([]);
  });

  it("compiles to NOTHING, and changes no audio document", () => {
    // Nothing bakes VideoPluginDoc yet, so the run has no owner and its steps drop.
    const dir = join(root, "compiled.k7");
    mkdirSync(dir, { recursive: true });
    writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
    writeModule(dir, "audio", "amp", {
      plugin: { type: "internal", name: "Chorus" },
    });
    writeLane(dir, "gtr");
    const base = { gtr: ["amp"], amp: ["MIX"], MIX: ["OUT"] };
    writeDoc(join(dir, "graph.k7x"), { modules: base });
    const without = compileNodeProject(dir);
    writeDoc(join(dir, "graph.k7x"), {
      modules: { ...base, RENDER: ["VIDEO_OUT"] },
    });
    expect(compileNodeProject(dir)).toEqual(without);
  });
});

describe("hasVideoRun", () => {
  it("wants the KEY, not a destination naming it", () => {
    // `main: ["RENDER"]` names the sum without saying where it goes, so the line is still needed.
    expect(hasVideoRun({ modules: { main: ["RENDER"] } })).toBe(false);
    expect(hasVideoRun({ modules: { RENDER: ["VIDEO_OUT"] } })).toBe(true);
    expect(hasVideoRun({ bypassed: ["gtr"] })).toBe(false);
  });
});

describe("addVideoRun", () => {
  it("appends to the end of the modules map, keeping every comment", () => {
    const text =
      '// the graph\nmodules({\n  // the lane\n  gtr: ["MIX"],\n  MIX: ["OUT"],\n})\n';
    const after = added(text) ?? "";
    expect(after).toContain("// the graph\n");
    expect(after).toContain("// the lane\n");
    expect(Object.keys(new K7Document(after).toJS().modules as object)).toEqual(
      ["gtr", "MIX", "RENDER"],
    );
    expect(new K7Document(after).getIn(["modules", "RENDER"])).toEqual([
      "VIDEO_OUT",
    ]);
  });

  it("leaves the keys after the map where they were", () => {
    const text =
      'modules({ gtr: ["MIX"], MIX: ["OUT"] })\n\nbypassed(["gtr"])\n';
    const after = added(text) ?? "";
    expect(after.endsWith('\n\nbypassed(["gtr"])\n')).toBe(true);
    expect(new K7Document(after).toJS()).toEqual({
      modules: { gtr: ["MIX"], MIX: ["OUT"], RENDER: ["VIDEO_OUT"] },
      bypassed: ["gtr"],
    });
  });

  it("makes the modules map when the graph has none", () => {
    expect(new K7Document(added('bypassed(["gtr"])\n') ?? "").toJS()).toEqual({
      bypassed: ["gtr"],
      modules: { RENDER: ["VIDEO_OUT"] },
    });
  });

  it("refuses a `modules` that is not a map rather than replacing it", () => {
    expect(added('modules("gtr")\n')).toBeNull();
  });
});

describe("ensureVideoRun", () => {
  it("adds the run and reports that it wrote", () => {
    const dir = project(PLAIN);
    expect(ensureVideoRun(dir)).toBe(true);
    expect(modulesOf(dir).RENDER).toEqual(["VIDEO_OUT"]);
  });

  it("is idempotent — a second open changes nothing", () => {
    const dir = project(PLAIN);
    ensureVideoRun(dir);
    const after = read(dir);
    expect(ensureVideoRun(dir)).toBe(false);
    expect(read(dir)).toBe(after);
  });

  it("leaves a graph whose modules is not a map alone rather than failing to open", () => {
    const dir = project('modules("gtr")\n');
    expect(ensureVideoRun(dir)).toBe(false);
    expect(read(dir)).toBe('modules("gtr")\n');
  });

  it("says false for a project with no graph at all", () => {
    const dir = join(root, "bare.k7");
    mkdirSync(dir, { recursive: true });
    expect(ensureVideoRun(dir)).toBe(false);
  });
});

describe("where it is added from", () => {
  it("`project surface new viewport` brings the pair with it", () => {
    // Surface and outputs in one breath, so the frame has somewhere to leave by straight away.
    const dir = project(PLAIN, false);
    createSurfaceFile(dir, "viewport");
    expect(modulesOf(dir).RENDER).toEqual(["VIDEO_OUT"]);
  });

  it("a timeline surface brings NOTHING — a song with no picture never sees the names", () => {
    const dir = project(PLAIN, false);
    createSurfaceFile(dir, "timeline");
    expect(read(dir)).not.toContain("RENDER");
  });

  it("the `video` archetype is born with it, and `arrangement` is not", () => {
    const vid = join(root, "vid.k7");
    mkdirSync(vid, { recursive: true });
    scaffold(vid, "vid", "video");
    // Born as chain files: the picture's run is a chain starting at RENDER (docs/chainFiles.md).
    const starts = (d: string) =>
      Object.values(readChainProject(d).chains).map((c) => c.start);
    expect(starts(vid)).toContain("RENDER");
    expect(
      Object.values(readChainProject(vid).chains).find(
        (c) => c.start === "RENDER",
      )?.steps,
    ).toEqual([{ to: [{ chain: "VIDEO_OUT" }] }]);

    const arr = join(root, "arr.k7");
    mkdirSync(arr, { recursive: true });
    scaffold(arr, "arr");
    expect(starts(arr)).not.toContain("RENDER");
  });

  it("the scaffolded video graph still parses, and still declares the audio run", () => {
    // The archetype ADDS to the song's map, so the sound's run must survive the picture's splice.
    const vid = join(root, "both.k7");
    mkdirSync(vid, { recursive: true });
    scaffold(vid, "both", "video");
    const g = loadGraph(vid);
    expect(g.chains.MIX?.out.map((o) => o.to)).toEqual(["OUT"]);
    expect(g.chains.RENDER?.out.map((o) => o.to)).toEqual(["VIDEO_OUT"]);
    expect(validate(g)).toEqual([]);
  });
});
