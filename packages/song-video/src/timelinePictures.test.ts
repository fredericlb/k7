// A timeline's picture lanes in the PICTURE compile: drawn on the song's lane of their name where the
// timeline is placed, cut at its end, and compiled again at their own positions for the view that edits
// them (@studio/song docs/timelines.md).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVideoProject } from "./videoProject";

let ws: string;
let dir: string;
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);

/** Song lane `gtr` placing `events`, and timeline `verse` four seconds long at 120 bpm. */
function song(events: Record<string, unknown>[]): void {
  doc("nodes/gtr.k7x", { extends: "@meta/track", events });
  doc("timelines/verse.k7x", {
    length: "2:0",
    lanes: [{ lane: "x", events: [] }],
    pictures: [
      {
        lane: "cam",
        events: [
          { ref: "a", start: 0, length: 1 },
          { ref: "a", start: 1.5 },
        ],
      },
    ],
  });
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-tlpic-"));
  dir = join(ws, "song.k7");
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(join(dir, "clips/a.mp4"), "");
  doc("clips/a.k7x", { source: "clips/a.mp4" });
  doc("project.k7x", {
    project: { name: "t", tempo: 120, viewport: [640, 360] },
    trackOrder: ["gtr", "cam"],
  });
  doc("nodes/cam.k7x", {
    extends: "@meta/picture-track",
    frame: [10, 20, 320, 180],
    events: [{ ref: "a", start: 0, length: 1 }],
  });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a timeline's picture lane", () => {
  it("draws on the song's lane of its name, where the timeline plays, BEFORE the lane's own shots", () => {
    song([{ ref: "verse", start: "3:1" }]);
    const cam = loadVideoProject(dir).videoTracks[0];
    // Bar 3 at 120 bpm is 4 s; the open last shot is given the room left, 8 − 5.5.
    expect(
      cam.clips.map((c) => [c.start, c.length, c.timeline ?? null]),
    ).toEqual([
      [4, 1, "verse"],
      [5.5, 2.5, "verse"],
      [0, 1, null],
    ]);
  });

  it("shows nothing where its event is disabled", () => {
    song([{ ref: "verse", start: "3:1", disabled: true }]);
    expect(loadVideoProject(dir).videoTracks[0].clips).toHaveLength(1);
  });

  it("is compiled at its own positions, in the frame of the lane it draws on", () => {
    song([]);
    const [lane] = loadVideoProject(dir).timelines?.verse ?? [];
    expect(lane.id).toBe("verse>cam");
    expect([lane.x, lane.y, lane.w, lane.h]).toEqual([10, 20, 320, 180]);
    expect(lane.clips.map((c) => c.start)).toEqual([0, 1.5]);
  });

  it("says so when the song has no lane of its name", () => {
    song([{ ref: "verse", start: "1:1" }]);
    doc("timelines/verse.k7x", {
      lanes: [{ lane: "x", events: [] }],
      pictures: [
        { lane: "broll", events: [{ ref: "a", start: 0, length: 1 }] },
      ],
    });
    const pic = loadVideoProject(dir);
    expect(pic.warnings.join(" ")).toMatch(/verse>broll .* no(ne)?/);
    expect(pic.videoTracks[0].clips).toHaveLength(1);
  });
});
