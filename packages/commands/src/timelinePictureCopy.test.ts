// A PICTURE lane between timelines, through the dispatcher on real files: `timeline lane copy` of the
// song's lane and of a timeline's, the picture verbs on `<timeline>><lane>`, and the layer verbs refused
// there (@studio/song docs/timelines.md).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => loadProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};
const pictures = (id: string) =>
  wsData(join(dir, `timelines/${id}.k7x`)).pictures as {
    lane: string;
    events: { start: number }[];
  }[];
const shots = [
  { ref: "a", start: 0, length: 1 },
  { ref: "a", start: 2.5, length: 1 },
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "piccopy-"));
  dir = join(root, "song.k7");
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(join(dir, "clips/a.mp4"), "");
  doc("clips/a.k7x", { source: "clips/a.mp4" });
  doc("project.k7x", {
    project: { name: "t", tempo: 120, viewport: [640, 360] },
  });
  doc("nodes/cam.k7x", {
    extends: "@meta/picture-track",
    frame: [10, 20, 320, 180],
    events: shots,
  });
  doc("timelines/verse.k7x", {
    length: "2:0",
    lanes: [{ lane: "drums", events: [] }],
  });
  doc("timelines/chorus.k7x", {
    length: "2:0",
    lanes: [{ lane: "drums", events: [] }],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("timeline lane copy, a picture lane", () => {
  it("copies the song's picture lane into a timeline, under its own name", async () => {
    const h = await run("timeline lane copy cam verse");
    expect(h.lines.refuse).toEqual([]);
    expect(pictures("verse")).toEqual([{ lane: "cam", events: shots }]);
  });

  it("copies a timeline's picture lane onto another, named apart from what is there", async () => {
    await run("timeline lane copy cam verse");
    await run("timeline lane copy cam chorus");
    const h = await run("timeline lane copy verse>cam chorus");
    expect(h.lines.refuse).toEqual([]);
    expect(pictures("chorus").map((p) => p.lane)).toEqual(["cam", "cam-2"]);
  });

  it("does not take the name of the timeline's sound lane", async () => {
    await run("timeline lane copy cam verse drums");
    const h = await run("timeline lane copy cam verse drums");
    expect(h.lines.refuse.join(" ")).toMatch(/cannot name a new lane/);
  });

  it("copies a timeline's picture lane into the song as a full-frame lane", async () => {
    await run("timeline lane copy cam verse");
    const h = await run("timeline lane copy verse>cam main");
    expect(h.lines.refuse).toEqual([]);
    const made = wsData(join(dir, "nodes/cam-2.k7x"));
    expect(made).toEqual({ extends: "@meta/picture-track", events: shots });
    // The new lane is the top row, so it draws in front.
    const root = wsData(join(dir, "project.k7x")) as { trackOrder: string[] };
    expect(root.trackOrder).toEqual(["cam-2", "cam"]);
  });

  it("copies the song's picture lane within the song with its frame", async () => {
    await run("timeline lane copy cam main wide");
    expect(wsData(join(dir, "nodes/wide.k7x"))).toEqual({
      extends: "@meta/picture-track",
      frame: [10, 20, 320, 180],
      events: shots,
    });
  });
});

describe("the picture verbs on a timeline's lane", () => {
  beforeEach(async () => {
    await run("timeline lane copy cam verse");
  });

  it("moves a shot inside the timeline's file", async () => {
    const h = await run("picture move verse>cam 2.5 3");
    expect(h.lines.refuse).toEqual([]);
    expect(pictures("verse")[0].events.map((e) => e.start)).toEqual([0, 3]);
    // The song's lane it was copied from is untouched.
    expect(
      (wsData(join(dir, "nodes/cam.k7x")).events as { start: number }[]).map(
        (e) => e.start,
      ),
    ).toEqual([0, 2.5]);
  });

  it("refuses a verb about the layer, which is the song's", async () => {
    const h = await run("picture mute verse>cam");
    expect(h.lines.refuse.join(" ")).toMatch(/song's picture lane 'cam'/);
  });

  it("adds and removes a timeline's picture lane", async () => {
    await run("picture lane new verse>broll");
    expect(pictures("verse").map((p) => p.lane)).toEqual(["cam", "broll"]);
    const h = await run("timeline lane remove verse broll");
    expect(h.lines.refuse).toEqual([]);
    expect(pictures("verse").map((p) => p.lane)).toEqual(["cam"]);
  });
});
