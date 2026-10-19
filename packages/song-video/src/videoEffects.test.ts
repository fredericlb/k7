// A shot's own EFFECT: a run nothing feeds landing on the lane, named by `effect:`, carried in the
// picture document beside the stretches — the library's `grade` among them. What would go wrong
// silently: an effect naming a run on another lane applied anyway, or dropped without a word.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setLibraryOverlays } from "@studio/song/sharedFolders";
import { writeDoc } from "@studio/song/testSupport";
import { VideoPlacementSchema } from "@studio/song-schema/yaml/entitySchemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVideoProject } from "./videoProject";

const here = dirname(fileURLToPath(import.meta.url));
const LIBRARY = join(here, "..", "..", "..", "k7-core");

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "video-effects-"));
  dir = join(root, "film.k7");
  mkdirSync(join(dir, "clips"), { recursive: true });
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeDoc(join(dir, "project.k7x"), {
    project: {
      name: "t",
      tempo: 120,
      viewport: [640, 360, 30],
      layers: ["main", "pip"],
    },
  });
  writeDoc(join(dir, "clips", "a.k7x"), { source: "a.mp4" });
  writeFileSync(join(dir, "clips", "a.mp4"), "");
  writeDoc(join(dir, "video_tracks", "pip.k7x"), { events: [] });
  // The library's grade, through a node of the song's own — the shape every library module is used in.
  writeDoc(join(dir, "nodes", "warm.k7x"), {
    extends: "@k7-core/shaders/grade",
    params: { P4: 0.8 },
  });
  writeDoc(join(dir, "graph.k7x"), {
    modules: { warm: ["main"], RENDER: ["VIDEO_OUT"] },
  });
  setLibraryOverlays([{ name: "k7-core", root: LIBRARY }]);
});
afterEach(() => {
  setLibraryOverlays([]);
  rmSync(root, { recursive: true, force: true });
});

const events = (list: Record<string, unknown>[]) =>
  writeDoc(join(dir, "video_tracks", "main.k7x"), { events: list });

describe("a shot's effect", () => {
  it("carries the run under its head node, the library's grade GLSL in it", () => {
    events([{ ref: "a", start: 0, length: 2, effect: "warm" }]);
    const doc = loadVideoProject(dir);
    expect(doc.videoTracks.find((t) => t.id === "main")?.clips[0]?.effect).toBe(
      "warm",
    );
    const run = doc.stretches.warm;
    expect(run?.[0]?.params?.P4).toBe(0.8);
    expect(JSON.stringify(run)).toContain("Rec. 709 luma");
  });

  it("drops an effect naming no run landing on its lane, and says so", () => {
    events([{ ref: "a", start: 0, length: 2, effect: "cold" }]);
    const doc = loadVideoProject(dir);
    expect(
      doc.videoTracks.find((t) => t.id === "main")?.clips[0]?.effect,
    ).toBeUndefined();
    expect(doc.warnings.join("\n")).toMatch(/names effect 'cold'/);
  });

  it("carries a look's LUT as an absolute path, from the node that names it", () => {
    writeDoc(join(dir, "nodes", "film.k7x"), {
      extends: "@k7-core/shaders/look",
      lut: "looks/film.cube",
    });
    writeDoc(join(dir, "graph.k7x"), {
      modules: { film: ["main"], RENDER: ["VIDEO_OUT"] },
    });
    events([{ ref: "a", start: 0, length: 2, effect: "film" }]);
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
