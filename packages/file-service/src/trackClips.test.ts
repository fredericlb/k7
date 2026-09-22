// What a track HOLDS, as the graph carries it: the clips of each lane, in playing order, each
// with the position the SONG spells — which depends on the project's meter and is therefore
// computed here rather than in a browser. See @studio/ui-chains' docs/graphBuild.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc.ts";

let dir: string;

/** A one-lane project whose track holds `clips`, at the given time signature. */
function project(clips: string, sig = "4/4"): string {
  const p = join(dir, "song.st0");
  mkdirSync(join(p, "nodes"), { recursive: true });
  mkdirSync(join(p, "clips"), { recursive: true });
  mkdirSync(join(p, "modules", "io", "OUT"), { recursive: true });
  writeFileSync(
    join(p, "project.yaml"),
    `project:\n  name: "song"\n  tempo: 120\n  timeSignature: "${sig}"\n`,
  );
  writeFileSync(join(p, "modules", "io", "OUT", "module.yaml"), "io: out\n");
  writeFileSync(join(p, "graph.yaml"), "modules:\n  gtr: [ OUT ]\n");
  writeFileSync(
    join(p, "nodes", "gtr.yaml"),
    `extends: "@meta/track"\nevents:\n${clips}`,
  );
  // Two clips the lane can name. `source` is what makes one audio rather than missing.
  for (const id of ["verse", "chorus"])
    writeFileSync(
      join(p, "clips", `${id}.yaml`),
      `source: ${id}.wav\nduration: "4"\n`,
    );
  return p;
}

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
    const clips = lane(
      project(
        '  - { ref: chorus, start: "5:1:1" }\n  - { ref: verse, start: "1:1:1" }\n',
      ),
    );
    expect(clips?.map((c) => c.ref)).toEqual(["verse", "chorus"]);
  });

  it("spell the position the way the rest of the app spells one", () => {
    // `beatsToPosition`, so a downbeat is the shortest form and the renderer never divides beats itself.
    const clips = lane(project('  - { ref: verse, start: "5:1:1" }\n'));
    expect(clips?.[0].tc).toBe("5:1");
    expect(clips?.[0].start).toBe(16); // four bars of four, in beats
  });

  it("read the project's METER, not an assumed 4/4", () => {
    // In 3/4, beat 16 is bar 6 — a browser dividing by four would be wrong for every waltz.
    const clips = lane(project('  - { ref: verse, start: "6:1:1" }\n', "3/4"));
    expect(clips?.[0].tc).toBe("6:1");
    expect(clips?.[0].start).toBe(15);
  });

  it("say when a clip is MISSING", () => {
    // On a routing diagram a lane pointing at material that is not there looks exactly like a full one.
    const clips = lane(project('  - { ref: nope, start: "1:1:1" }\n'));
    expect(clips?.[0]).toMatchObject({ ref: "nope", kind: "missing" });
  });

  it("are absent for a lane that holds nothing", () => {
    // Not an empty array: a key promising an always-empty list is one every reader checks twice.
    expect(lane(project("  []\n"))).toBeUndefined();
  });
});

describe("a clip's LENGTH, for the mini timeline", () => {
  /** The compiled extents, as the workspace hands them over. */
  const extents = (starts: { start: number; length: number }[]) => ({
    gtr: starts,
  });

  it("comes from the compiled project, matched by position", () => {
    // `start` identifies a placement, since a lane may hold the same clip twice at two positions.
    const p = project(
      '  - { ref: verse, start: "1:1:1" }\n  - { ref: verse, start: "5:1:1" }\n',
    );
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
    // A compiled 0 means "the source's natural length", so the stand-in matches st0's timeline.
    const p = project('  - { ref: verse, start: "1:1:1" }\n');
    const clips = buildGraphDoc(p, extents([{ start: 0, length: 0 }]))
      .trackClips?.gtr;
    expect(clips?.[0].len).toBe(4);
  });

  it("is ABSENT when no extents are handed over, and the graph still builds", () => {
    // A project that will not compile has no extents, and the graph is the screen you fix it from.
    const p = project('  - { ref: verse, start: "1:1:1" }\n');
    const clips = buildGraphDoc(p).trackClips?.gtr;
    expect(clips).toHaveLength(1);
    expect(clips?.[0].len).toBeUndefined();
  });

  it("leaves a placement the compile does not know about without a length", () => {
    // A width borrowed from the neighbouring clip would be a confident lie about this one.
    const p = project('  - { ref: verse, start: "5:1:1" }\n');
    const clips = buildGraphDoc(p, extents([{ start: 0, length: 8 }]))
      .trackClips?.gtr;
    expect(clips?.[0].len).toBeUndefined();
  });
});
