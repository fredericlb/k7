import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldV1 } from "./scaffoldV1";
import { loadVideoProject, parseWallClock } from "./videoProject";

// A v1 project is a folder read as PICTURE: seconds, layers, no tempo. The cases below are
// the ones a wrong answer is invisible in — a lane silently not drawn, a marker read as a bar.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-v1-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Write project.yaml with the given `project:` body and optional root lines. */
function project(body: string, root = ""): void {
  writeFileSync(
    join(dir, "project.yaml"),
    `type: v1\nproject:\n${body}${root}`,
    "utf8",
  );
}

function lane(id: string, yaml: string): void {
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  writeFileSync(join(dir, "video_tracks", `${id}.yaml`), yaml, "utf8");
}

function clip(id: string, source: string): void {
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(
    join(dir, "clips", `${id}.yaml`),
    `source: ${source}\n`,
    "utf8",
  );
  // The media file too, empty: nothing here reads its bytes, but a missing source is its own
  // error and would mask the one each test is actually about.
  writeFileSync(join(dir, "clips", basename(source)), "", "utf8");
}

describe("a scaffolded v1 cut", () => {
  it("compiles to two lanes over one source, in layer order", () => {
    scaffoldV1(dir, "demo");
    const doc = loadVideoProject(dir);

    expect(doc.name).toBe("demo");
    expect(doc.viewport).toEqual([1280, 720]);
    expect(doc.fps).toBe(30);
    // ORDER, not membership: `layers: [main, pip]` is what puts the pip on top, and a sort
    // here would hide the one thing this asserts.
    expect(doc.videoTracks.map((t) => t.id)).toEqual(["main", "pip"]);
    // The pip starts 2s into the same source — the difference that makes the two lanes show
    // different frames, and the cheapest proof compositing has something to composite.
    expect(doc.videoTracks[1].clips[0].sourceFrom).toBe(2);
    // Absolute, like a ClipDoc's: whoever renders knows nothing about where the folder sits.
    expect(doc.videoTracks[0].clips[0].source).toContain("clips");
  });
});

describe("layers", () => {
  it("refuses a lane no layer names — it would compile and never draw", () => {
    project(`  viewport: [640, 360]\n  layers: [main]\n`);
    clip("a", "a.mp4");
    lane("main", `clips:\n  - { ref: a, start: 0, length: 1 }\n`);
    lane("ghost", `clips: []\n`);
    expect(() => loadVideoProject(dir)).toThrow(
      /ghost.*missing from project.layers/s,
    );
  });

  it("refuses a layer naming no lane", () => {
    project(`  viewport: [640, 360]\n  layers: [main, nope]\n`);
    lane("main", `clips: []\n`);
    expect(() => loadVideoProject(dir)).toThrow(/nope.*not a video track/s);
  });

  it("refuses a project with no viewport — a frame invented here letterboxes everything", () => {
    project(`  name: "x"\n`);
    expect(() => loadVideoProject(dir)).toThrow(/viewport is required/);
  });
});

describe("markers are wall-clock, not bars", () => {
  it("reads seconds, m:ss and m:ss.mmm", () => {
    expect(parseWallClock("90")).toBe(90);
    expect(parseWallClock("12.5")).toBe(12.5);
    expect(parseWallClock("1:30")).toBe(90);
    expect(parseWallClock("1:30.5")).toBe(90.5);
    // Not modelled on purpose: `1:30:00` is indistinguishable from a musical bar:beat:tick,
    // and one `markers:` schema serves both dialects. A three-hour cut writes 10800.
    expect(parseWallClock("1:30:00")).toBeNull();
    expect(parseWallClock("1:75")).toBeNull();
  });

  it("sorts them and keeps the key as written, which is the delete key", () => {
    project(
      `  viewport: [640, 360]\n  layers: []\n`,
      `markers:\n  "1:30.5": "the cut"\n  "0": "cold open"\n`,
    );
    mkdirSync(join(dir, "video_tracks"), { recursive: true });
    const doc = loadVideoProject(dir);
    expect(doc.markers.map((m) => [m.sec, m.name, m.tc])).toEqual([
      [0, "cold open", "0"],
      [90.5, "the cut", "1:30.5"],
    ]);
  });
});
