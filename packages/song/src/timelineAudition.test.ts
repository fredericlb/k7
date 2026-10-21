// Auditioning a timeline: the engine is sent that timeline alone from beat 0, through the lane it is
// first placed on, every other song lane silent (docs/timelines.md).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { writeDoc, writeLane, writeModule } from "./testSupport";
import { auditionHosts, auditionTimeline } from "./timelineAudition";

let dir = "";
let n = 0;

function project(songEvents: Record<string, unknown>[]): string {
  const p = join(dir, `p${n++}.k7`);
  writeDoc(join(p, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeModule(p, "io", "OUT", { io: "out" });
  writeLane(p, "song", "track", { events: songEvents });
  writeLane(p, "other", "track", { events: [{ ref: "kick", start: "1:1" }] });
  writeDoc(join(p, "clips", "kick.k7x"), { source: "clips/kick.wav", to: 1 });
  writeFileSync(join(p, "clips", "kick.wav"), "");
  writeDoc(join(p, "timelines", "verse.k7x"), {
    length: "1:0",
    lanes: [
      {
        lane: "drums",
        events: [
          { ref: "kick", start: "1:1" },
          { ref: "kick", start: "2:1" },
        ],
      },
    ],
  });
  writeDoc(join(p, "graph.k7x"), {
    modules: { song: ["OUT"], other: ["OUT"] },
  });
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "audition-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("auditioning a timeline", () => {
  it("plays it from beat 0 on the lane it is placed on, cut at its length", () => {
    const doc = compileNodeProject(
      project([
        { ref: "verse", start: "5:1" },
        { ref: "verse", start: "3:1" },
      ]),
    );
    expect(auditionHosts(doc, "verse")).toEqual(["song"]);
    const out = auditionTimeline(doc, "verse");
    const song = out.tracks.find((t) => t.id === "song");
    expect(song?.clips.map((c) => c.start)).toEqual([0]);
    expect(song?.mute).toBe(false);
  });

  it("silences every other lane", () => {
    const out = auditionTimeline(
      compileNodeProject(project([{ ref: "verse", start: "1:1" }])),
      "verse",
    );
    expect(out.tracks.find((t) => t.id === "other")).toMatchObject({
      mute: true,
      clips: [],
    });
  });

  it("plays one placed nowhere on a bare track of its own", () => {
    const out = auditionTimeline(compileNodeProject(project([])), "verse");
    expect(out.tracks.find((t) => t.id === "verse>")?.clips).toHaveLength(1);
  });

  it("leaves the document alone for a timeline that is not there", () => {
    const doc = compileNodeProject(project([]));
    expect(auditionTimeline(doc, "chorus")).toBe(doc);
  });
});
