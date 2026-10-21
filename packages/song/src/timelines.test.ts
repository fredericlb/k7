// A timeline placed as one event: its events play through the host lane, shifted and cut at its
// fixed length, and the surfaces get them tagged with that event (docs/timelines.md).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import type { ClipDoc } from "./project";
import { writeDoc, writeLane, writeModule } from "./testSupport";

let dir = "";
let n = 0;

/** A song lane `song` placing `events`, beside a `verse` timeline of drums (audio) and bass (notes). */
function project(
  events: Record<string, unknown>[],
  verse: Record<string, unknown> = {},
  more: Record<string, Record<string, unknown>> = {},
): string {
  const p = join(dir, `p${n++}.k7`);
  writeDoc(join(p, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeModule(p, "io", "OUT", { io: "out" });
  writeLane(p, "song", "track", { events });
  writeDoc(join(p, "clips", "kick.k7x"), { source: "clips/kick.wav", to: 1 });
  writeFileSync(join(p, "clips", "kick.wav"), "");
  writeDoc(join(p, "sequences", "bassline.k7x"), {
    notes: [{ t: 0, d: 12, k: 40 }],
  });
  writeDoc(join(p, "timelines", "verse.k7x"), {
    length: "2:0",
    lanes: [
      { lane: "drums", events: [{ ref: "kick", start: "1:1" }] },
      { lane: "bass", events: [{ ref: "bassline", start: "1:1" }] },
    ],
    ...verse,
  });
  for (const [id, body] of Object.entries(more))
    writeDoc(join(p, "timelines", `${id}.k7x`), body);
  writeDoc(join(p, "graph.k7x"), { modules: { song: ["OUT"] } });
  return p;
}

const clipsOf = (p: string): ClipDoc[] =>
  compileNodeProject(p).tracks.flatMap((t) => t.clips);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "timelines-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a timeline placed as an event", () => {
  it("plays its events through the host lane, shifted to where it starts", () => {
    const clips = clipsOf(project([{ ref: "verse", start: "3:1" }]));
    const kick = clips.find((c) => c.name === "kick");
    const bass = clips.find((c) => c.name === "bassline");
    expect(kick?.start).toBe(8);
    expect(bass?.start).toBe(8);
    expect(kick?.id).toBe("verse@8>kick@0");
    expect(kick?.nest).toEqual({
      of: "verse@8",
      ref: "verse",
      start: 8,
      length: 8,
    });
  });

  it("cuts what runs past its fixed length", () => {
    const bass = clipsOf(project([{ ref: "verse", start: "1:1" }])).find(
      (c) => c.name === "bassline",
    );
    // Twelve beats of notes in a two-bar timeline.
    expect(bass?.length).toBe(8);
  });

  it("is as long as its content, rounded up to the bar, when it states no length", () => {
    const doc = compileNodeProject(
      project([{ ref: "verse", start: "1:1" }], { length: undefined }),
    );
    expect(doc.timelines?.[0].length).toBe(12);
  });

  it("carries its gain and its mute onto every clip", () => {
    const clips = clipsOf(
      project([{ ref: "verse", start: "1:1", gain: -3, disabled: true }]),
    );
    expect(clips.every((c) => c.disabled)).toBe(true);
    expect(clips.find((c) => c.name === "kick")?.gainDb).toBe(-3);
    expect(clips.find((c) => c.name === "bassline")?.gainDb).toBeUndefined();
  });

  it("nests, the outermost event naming every clip", () => {
    const clips = clipsOf(
      project(
        [{ ref: "song-part", start: "2:1" }],
        {},
        {
          "song-part": {
            lanes: [{ lane: "a", events: [{ ref: "verse", start: "2:1" }] }],
          },
        },
      ),
    );
    const kick = clips.find((c) => c.name === "kick");
    expect(kick?.start).toBe(8);
    expect(kick?.id).toBe("song-part@4>verse@4>kick@0");
    expect(kick?.nest?.of).toBe("song-part@4");
  });

  it("refuses a window, a loop or a fade: its extent is fixed", () => {
    expect(() =>
      compileNodeProject(project([{ ref: "verse", start: "1:1", loop: 2 }])),
    ).toThrow(/extent is its timeline's length/);
  });

  it("refuses a timeline placed inside itself", () => {
    expect(() =>
      compileNodeProject(
        project([{ ref: "verse", start: "1:1" }], {
          lanes: [{ lane: "x", events: [{ ref: "verse", start: "1:1" }] }],
        }),
      ),
    ).toThrow(/placed inside itself/);
  });

  it("names a missing ref inside a timeline by its lane", () => {
    expect(() =>
      compileNodeProject(
        project([], {
          lanes: [{ lane: "x", events: [{ ref: "nope", start: "1:1" }] }],
        }),
      ),
    ).toThrow(/timeline 'verse' lane 'x': clip\/sequence 'nope' not found/);
  });

  it("compiles every timeline for its own view, lanes addressed through it", () => {
    const doc = compileNodeProject(project([]));
    expect(doc.timelines?.map((t) => t.id)).toEqual(["verse"]);
    expect(doc.timelines?.[0].lanes.map((l) => l.id)).toEqual([
      "verse>drums",
      "verse>bass",
    ]);
    expect(doc.timelines?.[0].lanes[0].clips[0].start).toBe(0);
  });
});
