// A SHAPE is a module that draws a primitive and takes no picture in — the other source a video
// lane can be fed by. Pinned here: which lane a shape lands on, what its `params:` compile to, and
// what a shape wired nowhere says out loud, since a lane drawing nothing looks like a lane.
// See packages/song-video/docs/shapes.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph, validate } from "@studio/song/graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileVideoChains } from "./videoChains";
import { loadVideoProject } from "./videoProject";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shape-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One shape module, in the type folder that is what says it draws. */
function module(name: string, body: string) {
  mkdirSync(join(dir, "modules", "shapes", name), { recursive: true });
  writeFileSync(join(dir, "modules", "shapes", name, "module.yaml"), body);
}

const BOX =
  "type: shape\nshape: square\ncolor: '#e2b53a'\nparams:\n  x: 40\n  y: 60\n  w: 200\n  h: 120\n";
const TITLE =
  "type: shape\nshape: text\ncontent: st0\nfont: sans-serif\ncolor: '#ffffff'\nparams:\n  x: 10\n  y: 20\n  font_size: 72\n";

/** A project with one picture lane, and whatever graph the case is about. */
function project(graph: string) {
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    'project:\n  name: "film"\n  viewport: [1280, 720, 30]\n  layers: [main]\n',
  );
  writeFileSync(join(dir, "video_tracks", "main.yaml"), "events: []\n");
  module("box", BOX);
  module("title", TITLE);
  writeFileSync(join(dir, "graph.yaml"), graph);
  return dir;
}

const WIRED = "modules:\n  box: [ main ]\n  RENDER: [ VIDEO_OUT ]\n";
const BOTH =
  "modules:\n  box: [ main ]\n  title: [ main ]\n  RENDER: [ VIDEO_OUT ]\n";

describe("a shape wired to a picture lane", () => {
  it("compiles its fields and its params into the primitive it draws", () => {
    const g = loadGraph(project(WIRED));
    expect(compileVideoChains(dir, g).shapesByLane).toEqual({
      main: [
        {
          id: "box",
          type: "square",
          x: 40,
          y: 60,
          w: 200,
          h: 120,
          color: "#e2b53a",
        },
      ],
    });
  });

  it("reaches the compiled lane, which is what the renderer reads", () => {
    const doc = loadVideoProject(project(WIRED));
    expect(doc.videoTracks.find((t) => t.id === "main")?.shapes).toHaveLength(
      1,
    );
  });

  it("draws a TEXT off the same three keys a doc note and a font need", () => {
    const g = loadGraph(project("modules:\n  title: [ main ]\n"));
    expect(compileVideoChains(dir, g).shapesByLane.main).toEqual([
      {
        id: "title",
        type: "text",
        content: "st0",
        font: "sans-serif",
        fontSize: 72,
        x: 10,
        y: 20,
        color: "#ffffff",
      },
    ]);
  });

  it("stacks several on one lane, in the order the graph declares them", () => {
    const g = loadGraph(project(BOTH));
    expect(
      compileVideoChains(dir, g).shapesByLane.main.map((s) => s.id),
    ).toEqual(["box", "title"]);
  });

  it("leaves a lane nothing is wired to with no shape at all", () => {
    const doc = loadVideoProject(
      project("modules:\n  RENDER: [ VIDEO_OUT ]\n"),
    );
    expect(doc.videoTracks[0].shapes).toEqual([]);
  });

  it("draws nothing while the node is bypassed — a shape switched off is not drawn", () => {
    const g = loadGraph(project(`${WIRED}bypassed: [ box ]\n`));
    expect(compileVideoChains(dir, g).shapesByLane).toEqual({});
  });
});

describe("what an event on a lane of shapes is", () => {
  it("compiles a ref-less one to a span with no picture, and says nothing about it", () => {
    project(WIRED);
    writeFileSync(
      join(dir, "video_tracks", "main.yaml"),
      "events:\n  - { start: 2, length: 3 }\n  - { start: 8, length: 0 }\n",
    );

    const doc = loadVideoProject(dir);
    const lane = doc.videoTracks[0];

    expect(lane.clips).toEqual([
      { id: "", name: "", source: "", start: 2, length: 3, sourceFrom: 0 },
      { id: "", name: "", source: "", start: 8, length: 0, sourceFrom: 0 },
    ]);
    // NOT the "names no clip" warning: this event names none on purpose.
    expect(doc.warnings).toEqual([]);
  });

  it("says so when a shot is placed on one, since the shapes take the lane over", () => {
    project(WIRED);
    writeFileSync(
      join(dir, "clips", "shot.yaml"),
      "source: shot.mp4\nkind: video\n",
    );
    writeFileSync(
      join(dir, "video_tracks", "main.yaml"),
      "events:\n  - { ref: shot, start: 0, length: 4 }\n",
    );

    expect(loadVideoProject(dir).warnings.join(" ")).toContain(
      "shapes are wired to this lane, so its shots draw nothing",
    );
  });
});

describe("a shape that lands nowhere", () => {
  it("says so in the picture's warnings rather than drawing a blank lane", () => {
    const doc = loadVideoProject(
      project("modules:\n  box: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n"),
    );
    expect(doc.videoTracks[0].shapes).toEqual([]);
    expect(doc.warnings.join(" ")).toContain("'box' draws nothing");
  });

  it("is what validate() ACCEPTS on a picture lane, beside a camera", () => {
    const w = validate(loadGraph(project(WIRED)));
    expect(w.filter((s) => s.includes("picture lane"))).toEqual([]);
  });
});
