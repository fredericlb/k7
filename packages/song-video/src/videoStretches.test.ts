// A fade's STRETCH: a run of shaders nothing feeds, landing on a lane, named by a placement's
// `chain:`. That the graph accepts such a run, that the picture compile carries it under its head
// node, that a fade naming one blends `over` unless it says otherwise, and that a fade naming
// nothing falls back to a dissolve rather than to a cut. See docs/transitions.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph, validate } from "@studio/song/graph";
import { loadProject } from "@studio/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVideoProject } from "./videoProject";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "video-stretches-"));
  dir = join(root, "film.st0");
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  viewport: [640, 360, 30]\n  layers: [main, pip]\n",
  );
  writeFileSync(join(dir, "clips", "a.yaml"), "source: a.mp4\n");
  writeFileSync(join(dir, "clips", "a.mp4"), "");
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  writeFileSync(join(dir, "video_tracks", "pip.yaml"), "events: []\n");
  writeFileSync(join(dir, "video_tracks", "main.yaml"), "events: []\n");
  for (const name of ["iris", "zoom", "dim"]) shaderModule(name);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A workspace shader module with one program, used through a node of the same name. */
function shaderModule(name: string): void {
  const abs = join(root, "_modules", "shaders", name);
  mkdirSync(join(abs, "shaders", "p"), { recursive: true });
  writeFileSync(join(abs, "module.yaml"), "type: shader\nshader: p\n");
  writeFileSync(join(abs, "shaders", "p", "vertex.glsl"), `// ${name} v\n`);
  writeFileSync(join(abs, "shaders", "p", "fragment.glsl"), `// ${name} f\n`);
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", `${name}.yaml`),
    `extends: "@workspace/shaders/${name}"\n`,
  );
}

const graph = (text: string) =>
  writeFileSync(join(dir, "graph.yaml"), text, "utf8");
const events = (yaml: string) =>
  writeFileSync(join(dir, "video_tracks", "main.yaml"), `events:\n${yaml}`);

describe("a run of shaders nothing feeds, landing on a lane", () => {
  it("is a stretch: the graph reads it, and validate() has nothing to say", () => {
    graph(
      "modules:\n  zoom: [ dim ]\n  dim: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    const g = loadGraph(dir);
    expect(validate(g)).toEqual([]);
  });

  it("lands on a lane that ALSO starts a run — the lane is not absorbed into the stretch", () => {
    graph(
      "modules:\n  main: [ zoom ]\n  zoom: [ RENDER ]\n  iris: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    expect(validate(loadGraph(dir))).toEqual([]);
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks[0].plugins?.map((p) => p.name)).toEqual(["zoom"]);
  });

  it("does not trouble the SOUND's compile, which never hears of it — no bus for the lane it lands on", () => {
    graph(
      "modules:\n  main: [ zoom ]\n  zoom: [ RENDER ]\n  iris: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    const doc = loadProject(dir);
    expect(doc.tracks.map((t) => t.id)).not.toContain("main");
  });

  it("is no stretch when something DOES feed it — then it is that lane's run, and refused", () => {
    graph(
      "modules:\n  pip: [ iris ]\n  iris: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    expect(validate(loadGraph(dir))).not.toEqual([]);
    events(
      "  - { ref: a, start: 0, length: 4, fade_in: { over: 1, chain: iris } }\n",
    );
    expect(loadVideoProject(dir).stretches).toEqual({});
  });
});

describe("a fade naming a stretch", () => {
  it("carries the run under its HEAD node, in order, with its GLSL read in", () => {
    graph(
      "modules:\n  zoom: [ dim ]\n  dim: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    events(
      "  - { ref: a, start: 0, length: 4, fade_in: { over: 1, chain: zoom } }\n",
    );
    const doc = loadVideoProject(dir);
    expect(doc.warnings).toEqual([]);
    expect(doc.stretches.zoom.map((p) => [p.id, p.name])).toEqual([
      ["zoom:0", "zoom"],
      ["zoom:1", "dim"],
    ]);
    expect(doc.stretches.zoom[0].shader?.fragment).toBe("// zoom f\n");
    // The lane's own run is something else, and it has none.
    expect(doc.videoTracks[0].plugins).toBeUndefined();
  });

  it("blends `over` when it names no kind — the stretch's own alpha is the mix", () => {
    graph("modules:\n  iris: [ main ]\n  RENDER: [ VIDEO_OUT ]\n");
    events(
      "  - { ref: a, start: 0, length: 4, fade_in: { over: 1, chain: iris } }\n",
    );
    expect(loadVideoProject(dir).videoTracks[0].clips[0].fadeIn).toEqual({
      over: 1,
      with: "over",
      chain: "iris",
    });
  });

  it("keeps a kind it DOES name, which then blends what the stretch left", () => {
    graph("modules:\n  iris: [ main ]\n  RENDER: [ VIDEO_OUT ]\n");
    events(
      "  - { ref: a, start: 0, length: 4, fade_out: { over: 1, chain: iris, with: dissolve } }\n",
    );
    expect(loadVideoProject(dir).videoTracks[0].clips[0].fadeOut).toEqual({
      over: 1,
      with: "dissolve",
      chain: "iris",
    });
  });

  it("carries only the stretches a fade names", () => {
    graph(
      "modules:\n  iris: [ main ]\n  zoom: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    events(
      "  - { ref: a, start: 0, length: 4, fade_in: { over: 1, chain: iris } }\n",
    );
    expect(Object.keys(loadVideoProject(dir).stretches)).toEqual(["iris"]);
  });
});

describe("a fade naming no stretch of its lane", () => {
  it("fades as a DISSOLVE and says so — a cut would move the arrangement", () => {
    graph("modules:\n  iris: [ pip ]\n  RENDER: [ VIDEO_OUT ]\n");
    events(
      "  - { ref: a, start: 0, length: 4, fade_in: { over: 1, chain: iris } }\n",
    );
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks[0].clips[0].fadeIn).toEqual({
      over: 1,
      with: "dissolve",
    });
    expect(doc.warnings).toEqual([
      expect.stringContaining(
        "names chain 'iris', which is no run of shaders landing on this lane",
      ),
    ]);
    expect(doc.stretches).toEqual({});
  });
});

describe("in a CHAIN project, a stretch is a subchain of its lane's chain", () => {
  const chain = (name: string, text: string) => {
    mkdirSync(join(dir, "chains"), { recursive: true });
    writeFileSync(join(dir, "chains", `${name}.yaml`), text);
  };
  const lane = (id: string, subs: string) =>
    chain(
      id,
      `start: true\nsteps:\n  - { id: lane-${id}, video_track: ${id} }\n  - to: [ { chain: RENDER } ]\nsubchains:\n${subs}`,
    );
  const sub = (id: string, node: string) =>
    `  - id: ${id}\n    steps:\n      - { id: ${node}, extends: "@workspace/shaders/iris" }\n`;
  beforeEach(() => {
    rmSync(join(dir, "nodes"), { recursive: true, force: true });
    chain(
      "picture",
      "start: RENDER\nsteps:\n  - to: [ { chain: VIDEO_OUT } ]\n",
    );
  });

  it("is named by its id, and runs from its first node", () => {
    lane("main", sub("opening", "iris-1"));
    events(
      "  - { ref: a, start: 0, length: 4, fade_in: { over: 1, chain: opening } }\n",
    );
    const doc = loadVideoProject(dir);
    expect(doc.warnings).toEqual([]);
    expect(doc.videoTracks[0].clips[0].fadeIn?.chain).toBe("iris-1");
    expect(doc.stretches["iris-1"].map((p) => p.shader?.fragment)).toEqual([
      "// iris f\n",
    ]);
  });

  it("is the LANE's own: another lane's subchain of the same id is not reached", () => {
    lane("main", sub("other", "iris-1"));
    lane("pip", sub("opening", "iris-2"));
    events(
      "  - { ref: a, start: 0, length: 4, fade_in: { over: 1, chain: opening } }\n",
    );
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks[0].clips[0].fadeIn).toEqual({
      over: 1,
      with: "dissolve",
    });
    expect(doc.warnings).toEqual([
      expect.stringContaining("names chain 'opening'"),
    ]);
  });
});
