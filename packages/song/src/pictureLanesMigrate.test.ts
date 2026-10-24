// The picture-lane migration over copies of the two real fixtures — the demo (a chain project) and
// the e2e lane (a node project) — and the cases they do not hold: a mute, an id an audio lane
// already has, a timeline's picture lane, and a lane that will not read. See pictureLanesMigrate.ts.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@studio/k7x/document";
import { validateFile } from "@studio/song-schema/yaml/validate";
import { afterEach, describe, expect, it } from "vitest";
import { migratePictureLanes } from "./pictureLanesMigrate";
import { copyOldPictureFixture } from "./testSupport";

const _REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A copy of a repository fixture, migrated in a temp folder. */
function copyOf(rel: string): string {
  dir = mkdtempSync(join(tmpdir(), "td-picmig-"));
  copyOldPictureFixture(rel, dir);
  return dir;
}
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
const data = (rel: string) => parse(read(rel));
/** The file validates against the schema its folder now names. */
const valid = (rel: string) =>
  expect(validateFile(join(dir, rel), read(rel)).issues).toEqual([]);

describe("a node project", () => {
  it("moves the lane to nodes/, its rect to frame, and the order into trackOrder", () => {
    copyOf("e2e/fixtures/video-lane.k7");
    const r = migratePictureLanes(dir);
    expect(r?.lanes).toEqual({ main: "main" });
    expect(existsSync(join(dir, "video_tracks"))).toBe(false);
    valid("nodes/main.k7x");
    expect(data("nodes/main.k7x")).toEqual({
      extends: "@meta/picture-track",
      frame: [0, 0, 1280, 720],
      events: [{ ref: "sample", start: 0, length: 6, from: 0 }],
    });
    const root = data("project.k7x");
    expect(root.trackOrder).toEqual(["drums", "main"]);
    expect((root.project as Record<string, unknown>).layers).toBeUndefined();
    expect(root.format).toBe(3);
  });

  it("puts a muted lane in the graph's bypassed list", () => {
    copyOf("e2e/fixtures/video-lane.k7");
    writeFileSync(
      join(dir, "video_tracks", "main.k7x"),
      'mute(true)\nevents([ref("sample").start(0)])\n',
    );
    migratePictureLanes(dir);
    expect(data("graph.k7x").bypassed).toEqual(["main"]);
    expect(data("nodes/main.k7x").mute).toBeUndefined();
  });

  it("gives a lane whose id an audio lane holds a new one, followed by its sounding lane", () => {
    copyOf("e2e/fixtures/video-lane.k7");
    writeFileSync(join(dir, "video_tracks", "drums.k7x"), "events([])\n");
    writeFileSync(
      join(dir, "project.k7x"),
      read("project.k7x").replace('["main"]', '["main", "drums"]'),
    );
    writeFileSync(
      join(dir, "nodes", "dialog.k7x"),
      'extends("@meta/track")\nvideo_source("drums")\n',
    );
    const r = migratePictureLanes(dir);
    expect(r?.lanes.drums).toBe("drums-picture");
    expect(r?.warnings.join()).toMatch(/drums-picture/);
    expect(data("nodes/dialog.k7x").video_source).toBe("drums-picture");
    // The rows draw the top layer first, below the audio lanes.
    expect(data("project.k7x").trackOrder).toEqual([
      "drums",
      "dialog",
      "drums-picture",
      "main",
    ]);
  });

  it("keeps a timeline's picture lanes apart, in the lane's words", () => {
    copyOf("e2e/fixtures/video-lane.k7");
    const tl = join(dir, "timelines", "intro.k7x");
    mkdirSync(dirname(tl));
    writeFileSync(
      tl,
      'lanes([{ lane: "beat", events: [] }])\npictures([{ lane: "main", events: [ref("sample").start(0).source_from(2)] }])\n',
    );
    migratePictureLanes(dir);
    valid("timelines/intro.k7x");
    expect(data("timelines/intro.k7x")).toEqual({
      lanes: [{ lane: "beat", events: [] }],
      pictures: [
        { lane: "main", events: [{ ref: "sample", start: 0, from: 2 }] },
      ],
    });
  });

  it("leaves the project untouched when a lane will not read", () => {
    copyOf("e2e/fixtures/video-lane.k7");
    writeFileSync(join(dir, "video_tracks", "bad.k7x"), "events([\n");
    const before = read("project.k7x");
    expect(() => migratePictureLanes(dir)).toThrow();
    expect(read("project.k7x")).toBe(before);
    expect(existsSync(join(dir, "video_tracks", "main.k7x"))).toBe(true);
    expect(existsSync(join(dir, "nodes", "main.k7x"))).toBe(false);
  });

  it("does nothing to a project with no picture lanes", () => {
    copyOf("e2e/fixtures/video-lane.k7");
    rmSync(join(dir, "video_tracks"), { recursive: true });
    expect(migratePictureLanes(dir)).toBeNull();
  });
});

describe("a chain project", () => {
  it("turns each picture item into a lane item, every lane file a valid lane", () => {
    copyOf("demos/video-demo.k7");
    const r = migratePictureLanes(dir);
    expect(Object.keys(r?.lanes ?? {}).sort()).toEqual([
      "box_layer",
      "dot_layer",
      "main",
      "pip",
      "title_layer",
    ]);
    for (const id of Object.keys(r?.lanes ?? {})) valid(`tracks/${id}.k7x`);
    for (const c of ["main", "box_layer", "title_layer"]) {
      valid(`chains/${c}.k7x`);
      expect(JSON.stringify(data(`chains/${c}.k7x`))).not.toMatch(
        /video_track/,
      );
    }
    expect(read("chains/main.k7x")).toMatch(/\.track\("main"\)/);
    // Comments survive: the lane file is edited, not rewritten.
    expect(read("tracks/main.k7x")).toMatch(
      /^extends\("@meta\/picture-track"\)/m,
    );
    expect(data("tracks/main.k7x").events).toEqual([
      { ref: "counter", start: 0, length: 4, from: 0 },
      {
        ref: "bars",
        start: 3,
        length: 5,
        from: 1.5,
        fadeIn: { over: 1, chain: "iris" },
      },
    ]);
    expect(data("project.k7x").trackOrder).toEqual([
      "drums",
      "title_layer",
      "dot_layer",
      "box_layer",
      "pip",
      "main",
    ]);
  });
});
