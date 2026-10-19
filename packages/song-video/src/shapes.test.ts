// A SHAPE is a module that draws a primitive and takes no picture in — the other source a video
// lane can be fed by. Pinned here: which lane a shape lands on, what its `params:` compile to, and
// what a shape wired nowhere says out loud, since a lane drawing nothing looks like a lane.
// See packages/song-video/docs/shapes.md.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph, validate } from "@studio/song/graph";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileVideoChains } from "./videoChains";
import { loadVideoProject } from "./videoProject";

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shape-"));
  dir = join(root, "film.k7");
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** One shape module, at the WORKSPACE level (a sibling of the project), used through a node of the same name. */
function module(name: string, body: Record<string, unknown>) {
  writeDoc(join(root, "_modules", "shapes", name, "module.k7x"), body);
  writeDoc(join(dir, "nodes", `${name}.k7x`), {
    extends: `@workspace/shapes/${name}`,
  });
}

const BOX = {
  type: "shape",
  shape: "square",
  color: "#e2b53a",
  params: { x: 40, y: 60, w: 200, h: 120 },
};
const TITLE = {
  type: "shape",
  shape: "text",
  content: "k7",
  font: "sans-serif",
  color: "#ffffff",
  params: { x: 10, y: 20, font_size: 72 },
};

/** A project with one picture lane, and whatever graph the case is about. */
function project(graph: Record<string, unknown>) {
  writeDoc(join(dir, "project.k7x"), {
    project: { name: "film", viewport: [1280, 720, 30], layers: ["main"] },
  });
  writeDoc(join(dir, "video_tracks", "main.k7x"), { events: [] });
  module("box", BOX);
  module("title", TITLE);
  writeDoc(join(dir, "graph.k7x"), graph);
  return dir;
}

const WIRED = { modules: { box: ["main"], RENDER: ["VIDEO_OUT"] } };
const BOTH = {
  modules: { box: ["main"], title: ["main"], RENDER: ["VIDEO_OUT"] },
};

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
    const g = loadGraph(project({ modules: { title: ["main"] } }));
    expect(compileVideoChains(dir, g).shapesByLane.main).toEqual([
      {
        id: "title",
        type: "text",
        content: "k7",
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
      project({ modules: { RENDER: ["VIDEO_OUT"] } }),
    );
    expect(doc.videoTracks[0].shapes).toEqual([]);
  });

  it("draws nothing while the node is bypassed — a shape switched off is not drawn", () => {
    const g = loadGraph(project({ ...WIRED, bypassed: ["box"] }));
    expect(compileVideoChains(dir, g).shapesByLane).toEqual({});
  });
});

describe("what an event on a lane of shapes is", () => {
  it("compiles a ref-less one to a span with no picture, and says nothing about it", () => {
    project(WIRED);
    writeDoc(join(dir, "video_tracks", "main.k7x"), {
      events: [
        { start: 2, length: 3 },
        { start: 8, length: 0 },
      ],
    });

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
    writeDoc(join(dir, "clips", "shot.k7x"), {
      source: "shot.mp4",
      kind: "video",
    });
    writeDoc(join(dir, "video_tracks", "main.k7x"), {
      events: [{ ref: "shot", start: 0, length: 4 }],
    });

    expect(loadVideoProject(dir).warnings.join(" ")).toContain(
      "shapes are wired to this lane, so its shots draw nothing",
    );
  });
});

describe("a shape that lands nowhere", () => {
  it("says so in the picture's warnings rather than drawing a blank lane", () => {
    const doc = loadVideoProject(
      project({ modules: { box: ["RENDER"], RENDER: ["VIDEO_OUT"] } }),
    );
    expect(doc.videoTracks[0].shapes).toEqual([]);
    expect(doc.warnings.join(" ")).toContain("'box' draws nothing");
  });

  it("is what validate() ACCEPTS on a picture lane, beside a camera", () => {
    const w = validate(loadGraph(project(WIRED)));
    expect(w.filter((s) => s.includes("picture lane"))).toEqual([]);
  });
});
