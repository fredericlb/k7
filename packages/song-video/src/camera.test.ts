// A CAMERA is an io source that emits picture, wired in `graph.yaml` and landing on a video lane —
// the same shape a live audio input has against an audio lane. What is pinned here is the pair of
// halves that could each be silently wrong: which lane the lens lands on, and what `validate()`
// says about a cable that cannot mean anything. See packages/song/docs/camera.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph, validate } from "@studio/song/graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileVideoChains } from "./videoChains";
import { loadVideoProject } from "./videoProject";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cam-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A project with one picture lane, and whatever graph the case is about. */
function project(
  graph: string,
  camNode = 'extends: "@engine/CAM"\ncamera: "Logitech BRIO"\n',
) {
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    'project:\n  name: "film"\n  viewport: [1280, 720, 30]\n  layers: [main]\n',
  );
  writeFileSync(join(dir, "video_tracks", "main.yaml"), "kind: video\n");
  writeFileSync(join(dir, "nodes", "cam.yaml"), camNode);
  writeFileSync(join(dir, "graph.yaml"), graph);
  return dir;
}

const WIRED = "modules:\n  cam: [ main ]\n  RENDER: [ VIDEO_OUT ]\n";

describe("a camera wired to a picture lane", () => {
  it("lands its LABEL on that lane", () => {
    const g = loadGraph(project(WIRED));
    expect(compileVideoChains(dir, g).cameraByLane).toEqual({
      main: "Logitech BRIO",
    });
  });

  it("reaches the compiled lane, which is what the renderer reads", () => {
    const doc = loadVideoProject(project(WIRED));
    expect(doc.videoTracks.find((t) => t.id === "main")?.camera).toBe(
      "Logitech BRIO",
    );
  });

  it("says the DEFAULT camera when the node names none", () => {
    const g = loadGraph(project(WIRED, 'extends: "@engine/CAM"\n'));
    // "" and absent are two different answers: one lane has a lens, the other has none.
    expect(compileVideoChains(dir, g).cameraByLane).toEqual({ main: "" });
  });

  it("leaves a lane nothing is wired to alone", () => {
    const g = loadGraph(project("modules:\n  RENDER: [ VIDEO_OUT ]\n"));
    expect(compileVideoChains(dir, g).cameraByLane).toEqual({});
    expect(loadVideoProject(dir).videoTracks[0].camera).toBeUndefined();
  });

  it("is silent while the node is bypassed — a lens switched off opens nothing", () => {
    const g = loadGraph(project(WIRED));
    expect(compileVideoChains(dir, g).cameraByLane.main).toBe("Logitech BRIO");
    writeFileSync(join(dir, "graph.yaml"), `${WIRED}bypassed: [ cam ]\n`);
    const off = loadGraph(dir);
    expect(compileVideoChains(dir, off).cameraByLane).toEqual({});
  });
});

describe("what validate() refuses", () => {
  it("says nothing about a camera wired the way one is meant to be", () => {
    const w = validate(loadGraph(project(WIRED)));
    expect(w.filter((s) => s.includes("camera"))).toEqual([]);
  });

  it("refuses a cable INTO a camera — picture comes out of a lens, not in", () => {
    // TWO feeders, so the lens is a meeting point and therefore a DESTINATION: fed once it is
    // absorbed as a step instead, and a step is not something a cable is checked against.
    const dir2 = project(
      "modules:\n  a: [ cam ]\n  b: [ cam ]\n  cam: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    for (const n of ["a", "b"])
      writeFileSync(
        join(dir2, "nodes", `${n}.yaml`),
        "plugin: { type: jsdsp }\n",
      );
    expect(validate(loadGraph(dir2)).join(" ")).toContain(
      "is a camera — picture comes FROM it, not to it",
    );
  });

  it("does NOT insist on a picture lane — a lens draws a layer of its own", () => {
    const dir2 = project("modules:\n  cam: []\n  RENDER: [ VIDEO_OUT ]\n");
    expect(validate(loadGraph(dir2))).toEqual([]);
  });
});

describe("a camera with no lane at all", () => {
  it("draws a layer of its own, the whole frame, out of nothing but the node", () => {
    // No `video_tracks/` file and no `layers:` line: the document authors no lane, which is the
    // whole point of the shape. See packages/song/docs/camera.md.
    const dir2 = project("modules:\n  cam: []\n  RENDER: [ VIDEO_OUT ]\n");
    const layers = loadVideoProject(dir2).videoTracks;
    const lens = layers.find((t) => t.id === "cam");
    expect(lens?.camera).toBe("Logitech BRIO");
    expect([lens?.x, lens?.y, lens?.w, lens?.h]).toEqual([0, 0, 1280, 720]);
    expect(lens?.clips).toEqual([]);
  });

  it("takes the rectangle its node names", () => {
    const dir2 = project(
      "modules:\n  cam: []\n  RENDER: [ VIDEO_OUT ]\n",
      'extends: "@engine/CAM"\nframe: [40, 40, 320, 180]\n',
    );
    const lens = loadVideoProject(dir2).videoTracks.find((t) => t.id === "cam");
    expect([lens?.x, lens?.y, lens?.w, lens?.h]).toEqual([40, 40, 320, 180]);
  });

  it("draws ON TOP of the lanes the project does author", () => {
    const dir2 = project("modules:\n  cam: []\n  RENDER: [ VIDEO_OUT ]\n");
    const ids = loadVideoProject(dir2).videoTracks.map((t) => t.id);
    // `layers:` decides the order of the authored ones; a synthesised lens comes after them all.
    expect(ids[ids.length - 1]).toBe("cam");
    expect(ids).toContain("main");
  });

  it("refuses a picture lane fed by something that is not a camera", () => {
    // An ordinary module aimed at a lane draws nothing — the silence a lane's audio twin has too.
    const dir2 = project(
      "modules:\n  blur: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    writeFileSync(
      join(dir2, "nodes", "blur.yaml"),
      "plugin: { type: jsdsp }\n",
    );
    expect(validate(loadGraph(dir2)).join(" ")).toContain(
      "is a picture lane — only a camera's picture lands on one",
    );
  });
});
