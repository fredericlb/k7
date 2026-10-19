// `ClipDoc.event` — the placement's own words, carried through the compiler UNMERGED.
//
// Everything else on a compiled clip is the placement and its material resolved together, and that
// resolution is one-way: the two windows are intersected into `sourceFrom`/`sourceTo`, a sequence's
// window becomes a loop range, the passes are multiplied into `length`. So a surface could draw an
// event off a compiled document and could not write one back — which is what made copy/paste on the
// timeline drop the trim, the fades and the passes (apps/k7/frontend/src/clipboard.ts).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import type { ClipDoc } from "./project";
import { writeDoc, writeLane, writeModule } from "./testSupport";

let dir = "";

/** One lane playing `riff` once, with whatever the placement wants to say about it. */
function project(name: string, event: Record<string, unknown>): string {
  const p = join(dir, `${name}.k7`);
  writeDoc(join(p, "project.k7x"), { project: { name, tempo: 120 } });
  writeModule(p, "io", "OUT", { io: "out" });
  writeLane(p, "gtr", "track", {
    events: [{ ref: "riff", start: "1:1:1", ...event }],
  });
  // The material must state a `to`, since a repeat needs an end to come round from.
  writeDoc(join(p, "clips", "riff.k7x"), {
    source: "clips/riff.wav",
    to: 8,
  });
  writeFileSync(join(p, "clips", "riff.wav"), "");
  writeDoc(join(p, "graph.k7x"), { modules: { gtr: ["OUT"] } });
  return p;
}

const clipOf = (p: string): ClipDoc =>
  compileNodeProject(p).tracks.flatMap((t) => t.clips)[0];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "evattrs-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a placement's own words", () => {
  it("carries every field the event stated", () => {
    const c = clipOf(
      project("all", {
        from: 1.5,
        to: 6.5455,
        fadeIn: "0:2",
        fadeOut: "0:1",
        loop: 3,
        disabled: true,
        warp: false,
      }),
    );
    expect(c.event).toEqual({
      from: 1.5,
      to: 6.5455,
      fadeIn: "0:2",
      fadeOut: "0:1",
      loop: 3,
      disabled: true,
      warp: false,
    });
  });

  /** As AUTHORED: resolved to seconds, the value written back would move when the tempo does. */
  it("keeps a timecode window spelled as a timecode", () => {
    const c = clipOf(project("tc", { from: "2:1", to: "4:1" }));
    expect(c.event?.from).toBe("2:1");
    expect(c.event?.to).toBe("4:1");
  });

  // …and NOT the resolved `sourceFrom` beside it: only one of the two can be written back.
  it("sits beside the resolved window rather than replacing it", () => {
    const c = clipOf(project("both", { from: "2:1" }));
    expect(c.event?.from).toBe("2:1"); // as written
    expect(c.sourceFrom).toBeCloseTo(2, 6); // one bar at 120bpm, in seconds
  });

  /** Absent rather than defaulted: a `loop: 1` here lands in the file of every pasted event. */
  it("is absent on an event that stated nothing", () => {
    expect(clipOf(project("bare", {})).event).toBeUndefined();
  });

  it("leaves out the values that mean the default", () => {
    expect(
      clipOf(project("dflt", { loop: 1, warp: true })).event,
    ).toBeUndefined();
  });
});
