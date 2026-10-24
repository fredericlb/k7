// The path graph.k7x -> the renderer, which is what a shader needs: a video lane's run onto that
// lane, the RENDER run onto the frame, and the audio side input that drives a shader.
// See docs/shaders.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph, validate } from "@studio/song/graph";
import { writeDoc, writeLane } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileVideoChains } from "./videoChains";
import { loadVideoProject } from "./videoProject";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "video-chains-"));
  dir = join(root, "film.k7");
  mkdirSync(dir, { recursive: true });
  writeDoc(join(dir, "project.k7x"), {
    project: {
      name: "t",
      tempo: 120,
      viewport: [640, 360, 30],
    },
    trackOrder: ["main"],
  });
  writeLane(dir, "main", "picture-track", {
    frame: [0, 0, 640, 360],
    events: [],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A shader module at the WORKSPACE level, with one shader folder and whatever fields it needs, used through a node of the same name. */
function shaderModule(
  name: string,
  body: Record<string, unknown>,
  shaders = ["pulse"],
): void {
  const abs = join(root, "_modules", "shaders", name);
  writeDoc(join(abs, "module.k7x"), body);
  for (const s of shaders) {
    mkdirSync(join(abs, "shaders", s), { recursive: true });
    writeFileSync(join(abs, "shaders", s, "vertex.glsl"), `// ${s} vert\n`);
    writeFileSync(join(abs, "shaders", s, "fragment.glsl"), `// ${s} frag\n`);
  }
  writeDoc(join(dir, "nodes", `${name}.k7x`), {
    extends: `@workspace/shaders/${name}`,
  });
}

const graph = (value: Record<string, unknown>) =>
  writeDoc(join(dir, "graph.k7x"), value);
const compile = () => compileVideoChains(dir, loadGraph(dir));

describe("a video lane's run", () => {
  it("compiles onto the LANE, with the shader's source read in", () => {
    shaderModule("glow", {
      type: "shader",
      shader: "pulse",
      params: { P1: 0.5 },
    });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
    });
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
    shaderModule("glow", { type: "shader", shader: "pulse" });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
    });
    const g = loadGraph(dir);
    expect(g.warnings).toEqual([]);
    expect(validate(g)).toEqual([]);
  });

  it("keeps the four knobs, clamped to 0..1, and fills the ones nobody set", () => {
    // Clamped because the value leaves TypeScript for GLSL — see docs/shaders.md.
    shaderModule("glow", {
      type: "shader",
      shader: "pulse",
      params: { P1: 4, P2: -1 },
    });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
    });
    expect(compile().byLane.main[0].params).toEqual({
      P1: 1,
      P2: 0,
      P3: 0,
      P4: 0,
    });
  });

  it("compiles a shader with NOTHING picked, minus its source", () => {
    // A node you have just added: it keeps its card and its knobs, and the picture passes through.
    shaderModule("glow", { type: "shader" });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
    });
    const p = compile().byLane.main[0];
    expect(p.type).toBe("shader");
    expect(p.shader).toBeUndefined();
  });

  it("…and one whose folder is missing, the same way", () => {
    shaderModule("glow", { type: "shader", shader: "gone" });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
    });
    expect(compile().byLane.main[0].shader).toBeUndefined();
  });
});

describe("the audio side input", () => {
  it("names the LANE feeding the shader's audio port", () => {
    // A name and not a number, or a moving level would freeze into a cached document.
    shaderModule("glow", { type: "shader", shader: "pulse" });
    writeDoc(join(dir, "nodes", "gtr.k7x"), {
      extends: "@meta/track",
      events: [],
    });
    graph({
      modules: {
        gtr: ["MIX", "glow#audio"],
        MIX: ["OUT"],
        main: ["glow"],
        glow: ["RENDER"],
        RENDER: ["VIDEO_OUT"],
      },
    });
    expect(compile().byLane.main[0].audioFrom).toBe("gtr");
  });

  it("is absent when nothing is wired to it — the port is optional", () => {
    shaderModule("glow", { type: "shader", shader: "pulse" });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
    });
    expect(compile().byLane.main[0].audioFrom).toBeUndefined();
  });
});

describe("the frame's run", () => {
  it("compiles the RENDER -> VIDEO_OUT run onto the frame, not onto a lane", () => {
    shaderModule("grade", { type: "shader", shader: "pulse" });
    graph({
      modules: { main: ["RENDER"], RENDER: ["grade"], grade: ["VIDEO_OUT"] },
    });
    const { byLane, frame } = compile();
    expect(byLane).toEqual({});
    expect(frame).toHaveLength(1);
    expect(frame[0]).toMatchObject({ id: "RENDER:0", name: "grade" });
  });

  it("ignores a run out of the sum that never reaches the device", () => {
    // Not the frame's chain. Treating it as one would apply a pass the picture never reaches.
    shaderModule("grade", { type: "shader", shader: "pulse" });
    graph({ modules: { main: ["RENDER"], RENDER: ["grade"] } });
    expect(compile().frame).toEqual([]);
  });

  it("shades a lane AND the frame at once — both, which is the point", () => {
    shaderModule("glow", { type: "shader", shader: "pulse" });
    shaderModule("grade", { type: "shader", shader: "pulse" });
    graph({
      modules: {
        main: ["glow"],
        glow: ["RENDER"],
        RENDER: ["grade"],
        grade: ["VIDEO_OUT"],
      },
    });
    const { byLane, frame } = compile();
    expect(byLane.main.map((p) => p.name)).toEqual(["glow"]);
    expect(frame.map((p) => p.name)).toEqual(["grade"]);
  });
});

describe("bypass", () => {
  it("keeps a bypassed STEP, marked off, so the renderer can draw it", () => {
    shaderModule("glow", { type: "shader", shader: "pulse" });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
      bypassed: ["glow"],
    });
    expect(compile().byLane.main[0].enabled).toBe(false);
  });
});

describe("the document it lands in", () => {
  it("reaches VideoProjectDoc — the lane's plugins and framePlugins", () => {
    shaderModule("glow", { type: "shader", shader: "pulse" });
    graph({
      modules: { main: ["glow"], glow: ["RENDER"], RENDER: ["VIDEO_OUT"] },
    });
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks.find((t) => t.id === "main")?.plugins).toHaveLength(
      1,
    );
    expect(doc.framePlugins).toEqual([]);
  });

  it("still compiles the PICTURE when the graph will not parse", () => {
    // Best-effort by design — see docs/shaders.md.
    shaderModule("glow", { type: "shader", shader: "pulse" });
    graph({ modules: ["this is not a map"] });
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks.map((t) => t.id)).toEqual(["main"]);
    expect(doc.framePlugins).toEqual([]);
  });
});
