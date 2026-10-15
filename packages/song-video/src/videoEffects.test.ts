// A shot's own EFFECT: a run nothing feeds landing on the lane, named by `effect:`, carried in the
// picture document beside the stretches — the library's `grade` among them. What would go wrong
// silently: an effect naming a run on another lane applied anyway, or dropped without a word.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setLibraryOverlays } from "@studio/song/sharedFolders";
import { VideoPlacementSchema } from "@studio/song-schema/yaml/entitySchemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVideoProject } from "./videoProject";

const here = dirname(fileURLToPath(import.meta.url));
const LIBRARY = join(here, "..", "..", "..", "st0-library");

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "video-effects-"));
  dir = join(root, "film.st0");
  mkdirSync(join(dir, "clips"), { recursive: true });
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  viewport: [640, 360, 30]\n  layers: [main, pip]\n",
  );
  writeFileSync(join(dir, "clips", "a.yaml"), "source: a.mp4\n");
  writeFileSync(join(dir, "clips", "a.mp4"), "");
  writeFileSync(join(dir, "video_tracks", "pip.yaml"), "events: []\n");
  // The library's grade, through a node of the song's own — the shape every library module is used in.
  writeFileSync(
    join(dir, "nodes", "warm.yaml"),
    'extends: "@st0/shaders/grade"\nparams: { P4: 0.8 }\n',
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    "modules:\n  warm: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
  );
  setLibraryOverlays([{ name: "st0", root: LIBRARY }]);
});
afterEach(() => {
  setLibraryOverlays([]);
  rmSync(root, { recursive: true, force: true });
});

const events = (yaml: string) =>
  writeFileSync(join(dir, "video_tracks", "main.yaml"), `events:\n${yaml}`);

describe("a shot's effect", () => {
  it("carries the run under its head node, the library's grade GLSL in it", () => {
    events("  - { ref: a, start: 0, length: 2, effect: warm }\n");
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks.find((t) => t.id === "main")?.clips[0]?.effect).toBe(
      "warm",
    );
    const run = doc.stretches.warm;
    expect(run?.[0]?.params?.P4).toBe(0.8);
    expect(JSON.stringify(run)).toContain("Rec. 709 luma");
  });

  it("drops an effect naming no run landing on its lane, and says so", () => {
    events("  - { ref: a, start: 0, length: 2, effect: cold }\n");
    const doc = loadVideoProject(dir);
    expect(
      doc.videoTracks.find((t) => t.id === "main")?.clips[0]?.effect,
    ).toBeUndefined();
    expect(doc.warnings.join("\n")).toMatch(/names effect 'cold'/);
  });

  it("carries a look's LUT as an absolute path, from the node that names it", () => {
    writeFileSync(
      join(dir, "nodes", "film.yaml"),
      'extends: "@st0/shaders/look"\nlut: looks/film.cube\n',
    );
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  film: [ main ]\n  RENDER: [ VIDEO_OUT ]\n",
    );
    events("  - { ref: a, start: 0, length: 2, effect: film }\n");
    const run = loadVideoProject(dir).stretches.film;
    expect(run?.[0]?.lut).toBe(join(dir, "looks", "film.cube"));
    expect(run?.[0]?.shader?.fragment).toContain("uniform sampler3D uLut;");
  });

  it("refuses an effect on an activation, which has no picture to grade", () => {
    const r = VideoPlacementSchema.safeParse({
      start: 0,
      length: 2,
      effect: "warm",
    });
    expect(r.success).toBe(false);
  });
});
