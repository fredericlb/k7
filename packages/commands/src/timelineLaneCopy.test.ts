// `timeline lane copy`, through the dispatcher on real files: a lane's events copied onto a new lane
// of another timeline or of the song, the cycles and the song-to-song case refused (@studio/song docs/timelines.md).

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
const lanes = (id: string) =>
  wsData(join(dir, `timelines/${id}.k7x`)).lanes as {
    lane: string;
    events: unknown[];
  }[];
const drums = [
  { ref: "a", start: "1:1" },
  { ref: "a", start: "1:3", disabled: true },
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lanecopy-"));
  dir = join(root, "song.k7");
  doc("project.k7x", { project: { name: "t", tempo: 120 } });
  mkdirSync(join(dir, "clips"), { recursive: true });
  writeFileSync(join(dir, "clips/a.wav"), "");
  doc("clips/a.k7x", { source: "clips/a.wav", to: 1 });
  doc("tracks/gtr.k7x", {
    extends: "@meta/track",
    events: [{ ref: "a", start: "2:1" }],
  });
  doc("chains/gtr.k7x", {
    start: true,
    steps: [{ id: "lane-gtr", track: "gtr" }, { to: [{ chain: "MIX" }] }],
  });
  doc("timelines/verse.k7x", {
    length: "2:0",
    lanes: [{ lane: "drums", events: drums }],
  });
  doc("timelines/chorus.k7x", {
    length: "2:0",
    lanes: [{ lane: "drums", events: [] }],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("timeline lane copy", () => {
  it("copies a timeline's lane onto another, named apart from the lane already there", async () => {
    const h = await run("timeline lane copy verse>drums chorus");
    expect(h.lines.refuse).toEqual([]);
    expect(lanes("chorus")).toEqual([
      { lane: "drums", events: [] },
      { lane: "drums-2", events: drums },
    ]);
    // The source is left as it was.
    expect(lanes("verse")).toEqual([{ lane: "drums", events: drums }]);
  });

  it("copies a song lane into a timeline, under the name asked for", async () => {
    await run("timeline lane copy gtr verse guitar");
    expect(lanes("verse")[1]).toEqual({
      lane: "guitar",
      events: [{ ref: "a", start: "2:1" }],
    });
  });

  it("copies a timeline's lane into the song as a new lane", async () => {
    const h = await run("timeline lane copy verse>drums song");
    expect(h.lines.refuse).toEqual([]);
    const t = loadProject(dir).tracks.find((x) => x.id === "drums");
    expect(t?.clips.map((c) => [c.start, !!c.disabled])).toEqual([
      [0, false],
      [2, true],
    ]);
  });

  it("refuses song to song, and a copy that would put a timeline inside itself", async () => {
    const same = await run("timeline lane copy gtr song");
    expect(same.lines.refuse.join(" ")).toMatch(/track duplicate/);
    doc("timelines/verse.k7x", {
      length: "2:0",
      lanes: [{ lane: "x", events: [{ ref: "chorus", start: "1:1" }] }],
    });
    const loop = await run("timeline lane copy verse>x chorus");
    expect(loop.lines.refuse.join(" ")).toMatch(/inside 'chorus'/);
    expect(lanes("chorus")).toHaveLength(1);
  });

  it("refuses to name a timeline `song`", async () => {
    const h = await run("timeline new song");
    expect(h.lines.refuse.join(" ")).toMatch(/names the song/);
  });
});
