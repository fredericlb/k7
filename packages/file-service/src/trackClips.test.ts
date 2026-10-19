// What a track HOLDS, as the graph carries it: the clips of each lane, in playing order, each
// with the position the SONG spells — which depends on the project's meter and is therefore
// computed here rather than in a browser. See @studio/ui-chains' docs/graphBuild.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc.ts";

let dir: string;

/** A one-lane project whose track holds `clips`, at the given time signature. */
function project(clips: Placed[], sig = "4/4"): string {
  const p = join(dir, "song.k7");
  writeDoc(join(p, "project.k7x"), {
    project: { name: "song", tempo: 120, timeSignature: sig },
  });
  writeDoc(join(p, "modules", "io", "OUT", "module.k7x"), { io: "out" });
  writeDoc(join(p, "graph.k7x"), { modules: { gtr: ["OUT"] } });
  writeDoc(join(p, "nodes", "gtr.k7x"), {
    extends: "@meta/track",
    events: clips,
  });
  // Two clips the lane can name. `source` is what makes one audio rather than missing.
  for (const id of ["verse", "chorus"])
    writeDoc(join(p, "clips", `${id}.k7x`), {
      source: `${id}.wav`,
      duration: "4",
    });
  return p;
}

type Placed = { ref: string; start: string };
const at = (ref: string, start: string): Placed => ({ ref, start });

const lane = (dirPath: string) => buildGraphDoc(dirPath).trackClips?.gtr;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-trackclips-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a lane's clips, on the graph", () => {
  it("are sorted by POSITION, not by the order they were typed", () => {
    // A track file may name a clip at bar 5 before one at bar 1, and authored order would then mislead.
    const clips = lane(project([at("chorus", "5:1:1"), at("verse", "1:1:1")]));
    expect(clips?.map((c) => c.ref)).toEqual(["verse", "chorus"]);
  });

  it("spell the position the way the rest of the app spells one", () => {
    // `beatsToPosition`, so a downbeat is the shortest form and the renderer never divides beats itself.
    const clips = lane(project([at("verse", "5:1:1")]));
    expect(clips?.[0].tc).toBe("5:1");
    expect(clips?.[0].start).toBe(16); // four bars of four, in beats
  });

  it("read the project's METER, not an assumed 4/4", () => {
    // In 3/4, beat 16 is bar 6 — a browser dividing by four would be wrong for every waltz.
    const clips = lane(project([at("verse", "6:1:1")], "3/4"));
    expect(clips?.[0].tc).toBe("6:1");
    expect(clips?.[0].start).toBe(15);
  });

  it("say when a clip is MISSING", () => {
    // On a routing diagram a lane pointing at material that is not there looks exactly like a full one.
    const clips = lane(project([at("nope", "1:1:1")]));
    expect(clips?.[0]).toMatchObject({ ref: "nope", kind: "missing" });
  });

  it("are absent for a lane that holds nothing", () => {
    // Not an empty array: a key promising an always-empty list is one every reader checks twice.
    expect(lane(project([]))).toBeUndefined();
  });
});

describe("a clip's LENGTH, for the mini timeline", () => {
  /** The compiled extents, as the workspace hands them over. */
  const extents = (starts: { start: number; length: number }[]) => ({
    gtr: starts,
  });

  it("comes from the compiled project, matched by position", () => {
    // `start` identifies a placement, since a lane may hold the same clip twice at two positions.
    const p = project([at("verse", "1:1:1"), at("verse", "5:1:1")]);
    const clips = buildGraphDoc(
      p,
      extents([
        { start: 0, length: 8 },
        { start: 16, length: 32 },
      ]),
    ).trackClips?.gtr;
    expect(clips?.map((c) => c.len)).toEqual([8, 32]);
  });

  it("substitutes the timeline's own stand-in for a length of 0", () => {
    // A compiled 0 means "the source's natural length", so the stand-in matches k7's timeline.
    const p = project([at("verse", "1:1:1")]);
    const clips = buildGraphDoc(p, extents([{ start: 0, length: 0 }]))
      .trackClips?.gtr;
    expect(clips?.[0].len).toBe(4);
  });

  it("is ABSENT when no extents are handed over, and the graph still builds", () => {
    // A project that will not compile has no extents, and the graph is the screen you fix it from.
    const p = project([at("verse", "1:1:1")]);
    const clips = buildGraphDoc(p).trackClips?.gtr;
    expect(clips).toHaveLength(1);
    expect(clips?.[0].len).toBeUndefined();
  });

  it("leaves a placement the compile does not know about without a length", () => {
    // A width borrowed from the neighbouring clip would be a confident lie about this one.
    const p = project([at("verse", "5:1:1")]);
    const clips = buildGraphDoc(p, extents([{ start: 0, length: 8 }]))
      .trackClips?.gtr;
    expect(clips?.[0].len).toBeUndefined();
  });
});
