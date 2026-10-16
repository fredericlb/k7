import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { scaffold } from "@studio/song/scaffold";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVideoProject, parseWallClock } from "./videoProject";

// The SAME folder read as PICTURE — a song's second compile, in the cases a wrong answer hides in.

// A workspace, not the bare tmpdir itself: `scaffold()` seeds a WORKSPACE-level `_modules`
// beside the project (one level up), and a `dir` with no workspace of its own sends that
// straight into the shared OS tmp root instead of this test's own cleaned-up folder.
let ws: string;
let dir: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-pic-"));
  dir = join(ws, "song.k7");
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

/** Write project.yaml with the given `project:` body and optional root lines. */
function project(body: string, root = ""): void {
  writeFileSync(join(dir, "project.yaml"), `project:\n${body}${root}`, "utf8");
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
  // The media file too, empty: a missing source is its own error and would mask the one under test.
  writeFileSync(join(dir, "clips", basename(source)), "", "utf8");
}

describe("a scaffolded `video` project", () => {
  it("carries picture, compiled from the same folder as its sound", () => {
    // One scaffold, one folder, two compiles — sound and picture in one KIND of project.
    scaffold(dir, "demo", "video");
    const doc = loadVideoProject(dir);

    expect(doc.name).toBe("demo");
    expect(doc.viewport).toEqual([1280, 720]);
    expect(doc.fps).toBe(30);
    // ORDER, not membership: `layers:` is what stacks them, and a sort here would hide it.
    expect(doc.videoTracks.map((t) => t.id)).toEqual(["main"]);
    // Absolute, like a ClipDoc's: whoever renders knows nothing about where the folder sits.
    expect(doc.videoTracks[0].clips[0].source).toContain("clips");
  });

  it("says nothing about tempo, which the OTHER compile of the same folder owns", () => {
    // The two documents describe one folder and share no field, so nothing strips picture out.
    scaffold(dir, "demo", "video");
    const doc = loadVideoProject(dir) as unknown as Record<string, unknown>;
    expect(doc.tempo).toBeUndefined();
    expect(doc.timeSignature).toBeUndefined();
    expect(doc.sampleRate).toBeUndefined();
  });

  it("gives an `arrangement` none — no viewport declared, so no frame to composite into", () => {
    // An arrangement is not a video project with its picture deleted: it declared no frame.
    scaffold(dir, "demo");
    expect(() => loadVideoProject(dir)).toThrow(/viewport is required/);
  });
});

describe("layers", () => {
  it("refuses a lane no layer names — it would compile and never draw", () => {
    project(`  viewport: [640, 360]\n  layers: [main]\n`);
    clip("a", "a.mp4");
    lane("main", `events:\n  - { ref: a, start: 0, length: 1 }\n`);
    lane("ghost", `events: []\n`);
    expect(() => loadVideoProject(dir)).toThrow(
      /ghost.*missing from project.layers/s,
    );
  });

  // The bug: a rect-less lane compiled to 0x0 and drew nothing, in FRONT of the full-frame one.
  it("gives a lane stating no rect the whole frame, not a 0x0 quad", () => {
    project(`  viewport: [640, 360]\n  layers: [main]\n`);
    clip("a", "a.mp4");
    lane("main", `events:\n  - { ref: a, start: 0, length: 1 }\n`);
    const [t] = loadVideoProject(dir).videoTracks;
    expect([t.x, t.y, t.w, t.h]).toEqual([0, 0, 640, 360]);
  });

  it("keeps a rect the lane DOES state", () => {
    project(`  viewport: [640, 360]\n  layers: [main]\n`);
    clip("a", "a.mp4");
    lane(
      "main",
      `x: 320\ny: 180\nw: 320\nh: 180\nevents:\n  - { ref: a, start: 0, length: 1 }\n`,
    );
    const [t] = loadVideoProject(dir).videoTracks;
    expect([t.x, t.y, t.w, t.h]).toEqual([320, 180, 320, 180]);
  });

  // A shot naming a clip that is not there COMPILES — and then draws nothing, which is the one
  // failure the frame cannot show you. It is a warning, not a throw: the rest of the picture is fine.
  it("reports a shot whose clip is missing rather than drawing a blank lane in silence", () => {
    project(`  viewport: [640, 360]\n  layers: [main]\n`);
    lane("main", `events:\n  - { ref: gone, start: 0, length: 1 }\n`);
    const doc = loadVideoProject(dir);
    expect(doc.warnings).toEqual([
      expect.stringContaining("'gone' names no clip"),
    ]);
    // …and the lane still compiles, so everything else in the frame still draws.
    expect(doc.videoTracks[0].clips[0].source).toBe("");
  });

  it("says nothing about a picture that is simply right", () => {
    project(`  viewport: [640, 360]\n  layers: [main]\n`);
    clip("a", "a.mp4");
    lane("main", `events:\n  - { ref: a, start: 0, length: 1 }\n`);
    expect(loadVideoProject(dir).warnings).toEqual([]);
  });

  it("refuses a layer naming no lane", () => {
    project(`  viewport: [640, 360]\n  layers: [main, nope]\n`);
    lane("main", `events: []\n`);
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
    // Not modelled on purpose: `1:30:00` would read as a musical bar:beat:tick.
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
