// The path graph.yaml -> the renderer, which is what a shader needs: a video lane's run onto that
// lane, the RENDER run onto the frame, and the audio side input that drives a shader.
// See docs/shaders.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph, validate } from "@studio/song/graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileVideoChains } from "./videoChains";
import { loadVideoProject } from "./videoProject";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "video-chains-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  viewport: [640, 360, 30]\n  layers: [main]\n",
  );
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  writeFileSync(
    join(dir, "video_tracks", "main.yaml"),
    "kind: video\nx: 0\ny: 0\nw: 640\nh: 360\nevents: []\n",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A shader module in the project, with one shader folder and whatever fields it needs. */
function shaderModule(name: string, body: string, shaders = ["pulse"]): void {
  const abs = join(dir, "modules", "shaders", name);
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, "module.yaml"), body);
  for (const s of shaders) {
    mkdirSync(join(abs, "shaders", s), { recursive: true });
    writeFileSync(join(abs, "shaders", s, "vertex.glsl"), `// ${s} vert\n`);
    writeFileSync(join(abs, "shaders", s, "fragment.glsl"), `// ${s} frag\n`);
  }
}

const graph = (text: string) =>
  writeFileSync(join(dir, "graph.yaml"), text, "utf8");
const compile = () => compileVideoChains(dir, loadGraph(dir));

describe("a video lane's run", () => {
  it("compiles onto the LANE, with the shader's source read in", () => {
    shaderModule("glow", "type: shader\nshader: pulse\nparams: { P1: 0.5 }\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    const { byLane, frame } = compile();
    expect(frame).toEqual([]);
    expect(byLane.main).toHaveLength(1);
    expect(byLane.main[0]).toMatchObject({
      id: "main:0",
      type: "shader",
      name: "glow",
      enabled: true,
    });
    expect(byLane.main[0].shader).toEqual({
      name: "pulse",
      vertex: "// pulse vert\n",
      fragment: "// pulse frag\n",
    });
  });

  it("does not warn — a video lane is a LANE in the derivation", () => {
    // What this pins: `main` starts the run, so reading it as the run's first STEP warns.
    shaderModule("glow", "type: shader\nshader: pulse\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    const g = loadGraph(dir);
    expect(g.warnings).toEqual([]);
    expect(validate(g)).toEqual([]);
  });

  it("keeps the four knobs, clamped to 0..1, and fills the ones nobody set", () => {
    // Clamped because the value leaves TypeScript for GLSL — see docs/shaders.md.
    shaderModule(
      "glow",
      "type: shader\nshader: pulse\nparams: { P1: 4, P2: -1 }\n",
    );
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    expect(compile().byLane.main[0].params).toEqual({
      P1: 1,
      P2: 0,
      P3: 0,
      P4: 0,
    });
  });

  it("compiles a shader with NOTHING picked, minus its source", () => {
    // A node you have just added: it keeps its card and its knobs, and the picture passes through.
    shaderModule("glow", "type: shader\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    const p = compile().byLane.main[0];
    expect(p.type).toBe("shader");
    expect(p.shader).toBeUndefined();
  });

  it("…and one whose folder is missing, the same way", () => {
    shaderModule("glow", "type: shader\nshader: gone\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    expect(compile().byLane.main[0].shader).toBeUndefined();
  });
});

describe("the audio side input", () => {
  it("names the LANE feeding the shader's audio port", () => {
    // A name and not a number, or a moving level would freeze into a cached document.
    shaderModule("glow", "type: shader\nshader: pulse\n");
    mkdirSync(join(dir, "nodes"), { recursive: true });
    writeFileSync(
      join(dir, "nodes", "gtr.yaml"),
      'extends: "@studio/track"\nevents: []\n',
    );
    graph(
      "modules:\n  gtr: [ MIX, glow#audio ]\n  MIX: [ OUT ]\n" +
        "  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    expect(compile().byLane.main[0].audioFrom).toBe("gtr");
  });

  it("is absent when nothing is wired to it — the port is optional", () => {
    shaderModule("glow", "type: shader\nshader: pulse\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    expect(compile().byLane.main[0].audioFrom).toBeUndefined();
  });
});

describe("the frame's run", () => {
  it("compiles the RENDER -> VIDEO_OUT run onto the frame, not onto a lane", () => {
    shaderModule("grade", "type: shader\nshader: pulse\n");
    graph(
      "modules:\n  main: [ RENDER ]\n  RENDER: [ grade ]\n  grade: [ VIDEO_OUT ]\n",
    );
    const { byLane, frame } = compile();
    expect(byLane).toEqual({});
    expect(frame).toHaveLength(1);
    expect(frame[0]).toMatchObject({ id: "RENDER:0", name: "grade" });
  });

  it("ignores a run out of the sum that never reaches the device", () => {
    // Not the frame's chain. Treating it as one would apply a pass the picture never reaches.
    shaderModule("grade", "type: shader\nshader: pulse\n");
    graph("modules:\n  main: [ RENDER ]\n  RENDER: [ grade ]\n");
    expect(compile().frame).toEqual([]);
  });

  it("shades a lane AND the frame at once — both, which is the point", () => {
    shaderModule("glow", "type: shader\nshader: pulse\n");
    shaderModule("grade", "type: shader\nshader: pulse\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n" +
        "  RENDER: [ grade ]\n  grade: [ VIDEO_OUT ]\n",
    );
    const { byLane, frame } = compile();
    expect(byLane.main.map((p) => p.name)).toEqual(["glow"]);
    expect(frame.map((p) => p.name)).toEqual(["grade"]);
  });
});

describe("bypass", () => {
  it("keeps a bypassed STEP, marked off, so the renderer can draw it", () => {
    shaderModule("glow", "type: shader\nshader: pulse\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\nbypassed: [ glow ]\n",
    );
    expect(compile().byLane.main[0].enabled).toBe(false);
  });
});

describe("the document it lands in", () => {
  it("reaches VideoProjectDoc — the lane's plugins and framePlugins", () => {
    shaderModule("glow", "type: shader\nshader: pulse\n");
    graph(
      "modules:\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks.find((t) => t.id === "main")?.plugins).toHaveLength(
      1,
    );
    expect(doc.framePlugins).toEqual([]);
  });

  it("still compiles the PICTURE when the graph will not parse", () => {
    // Best-effort by design — see docs/shaders.md.
    shaderModule("glow", "type: shader\nshader: pulse\n");
    graph("modules: [ this is not a map ]\n");
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks.map((t) => t.id)).toEqual(["main"]);
    expect(doc.framePlugins).toEqual([]);
  });
});
