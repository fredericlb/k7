// `picture lane rename` and `picture lane delete`, through the dispatcher on real files: every place
// that names a picture lane follows it — its file, `layers:`, `soloed:`, the graph, a sounding lane and
// the timelines drawing on it (src/verbs/pictureLane.ts).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData, wsWriteText } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
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
const data = (rel: string) => wsData(join(dir, rel)) as Record<string, any>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "piclane-"));
  dir = join(root, "song.k7");
  doc("project.k7x", {
    project: {
      name: "t",
      tempo: 120,
      viewport: [640, 360],
      layers: ["cam", "pip"],
    },
    soloed: ["cam"],
  });
  doc("video_tracks/cam.k7x", { events: [] });
  doc("video_tracks/pip.k7x", { events: [] });
  doc("timelines/verse.k7x", {
    lanes: [{ lane: "x", events: [] }],
    pictures: [{ lane: "cam", events: [] }],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("picture lane rename", () => {
  it("renames the file and every place that names the lane", async () => {
    wsWriteText(join(dir, "graph.k7x"), 'modules({ cam: ["pip"] })\n');
    const h = await run("picture lane rename cam wide");
    expect(h.lines.refuse).toEqual([]);
    expect(wsExists(join(dir, "video_tracks/wide.k7x"))).toBe(true);
    expect(wsExists(join(dir, "video_tracks/cam.k7x"))).toBe(false);
    const p = data("project.k7x");
    expect(p.project.layers).toEqual(["wide", "pip"]);
    expect(p.soloed).toEqual(["wide"]);
    expect(Object.keys(data("graph.k7x").modules)).toEqual(["wide"]);
    // The timeline's lane drew on `cam`, so it follows.
    expect(data("timelines/verse.k7x").pictures[0].lane).toBe("wide");
  });

  it("points a sounding lane at the new name", async () => {
    doc("nodes/dialog.k7x", { extends: "@meta/track", video_source: "cam" });
    await run("picture lane rename cam wide");
    expect(data("nodes/dialog.k7x").video_source).toBe("wide");
  });

  it("refuses a name another lane has", async () => {
    const h = await run("picture lane rename cam pip");
    expect(h.lines.refuse.join(" ")).toMatch(/already exists/);
  });

  it("renames a timeline's lane inside its file alone", async () => {
    const h = await run("picture lane rename verse>cam broll");
    expect(h.lines.refuse).toEqual([]);
    expect(data("timelines/verse.k7x").pictures[0].lane).toBe("broll");
    expect(wsExists(join(dir, "video_tracks/cam.k7x"))).toBe(true);
  });
});

describe("picture lane delete", () => {
  it("removes the file and the lane from `layers:` and `soloed:`", async () => {
    const h = await run("picture lane delete cam");
    expect(h.lines.refuse).toEqual([]);
    expect(wsExists(join(dir, "video_tracks/cam.k7x"))).toBe(false);
    const p = data("project.k7x");
    expect(p.project.layers).toEqual(["pip"]);
    expect(p.soloed).toBeUndefined();
    // A timeline lane drawing on it is left, and said to draw nowhere.
    expect(h.lines.log.join(" ")).toMatch(/verse>cam now draw/);
  });

  it("refuses while a lane plays its sound", async () => {
    doc("nodes/dialog.k7x", { extends: "@meta/track", video_source: "cam" });
    const h = await run("picture lane delete cam");
    expect(h.lines.refuse.join(" ")).toMatch(/dialog plays 'cam''s sound/);
    expect(wsExists(join(dir, "video_tracks/cam.k7x"))).toBe(true);
  });

  it("removes a timeline's lane from its file", async () => {
    await run("picture lane delete verse>cam");
    expect(data("timelines/verse.k7x").pictures).toEqual([]);
  });
});
