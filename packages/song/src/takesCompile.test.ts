// What a TAKE does to the compiled doc: it arrives with the same extents its clips would have on
// the lane, and it never reaches the engine. The file writers are tested in yaml/takes.test.ts;
// these are about the document a surface draws. See docs/takes.md.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { withoutTakes } from "./project";
import { writeLane, writeModule, writeYaml } from "./testSupport";

let dir = "";

// One lane, one bar of material, and a take of the same material placed a bar later.
function project(name: string, lane: Record<string, unknown>): string {
  const p = join(dir, `${name}.st0`);
  writeYaml(join(p, "project.yaml"), { project: { name } });
  writeModule(p, "io", "OUT", { io: "out" });
  writeLane(p, "gtr", "track", lane);
  writeYaml(join(p, "clips", "riff.yaml"), {
    source: "clips/riff.wav",
    to: "2:1",
  });
  writeFileSync(join(p, "clips", "riff.wav"), "");
  writeYaml(join(p, "graph.yaml"), { modules: { gtr: ["OUT"] } });
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "takes-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a lane's takes on the compiled doc", () => {
  const doc = () =>
    compileNodeProject(
      project("kept", {
        events: [{ ref: "riff", start: "1:1:1" }],
        takes: [{ events: [{ ref: "riff", start: "5:1:1" }] }],
      }),
    );

  it("compiles them like the arrangement they were, extents and all", () => {
    const t = doc().tracks.find((x) => x.id === "gtr");
    expect(t?.clips).toHaveLength(1);
    expect(t?.takes).toHaveLength(1);
    const [take] = t?.takes ?? [];
    expect(take.clips).toHaveLength(1);
    // Same material, same length — a take differs from the lane only in WHERE it is placed.
    expect(take.clips[0].length).toBe(t?.clips[0].length);
    expect(take.clips[0].source).toBe(t?.clips[0].source);
    expect(take.clips[0].start).toBe(16); // bar 5 at 4/4
  });

  it("does NOT play them: what the lane plays is its clips alone", () => {
    const t = doc().tracks.find((x) => x.id === "gtr");
    expect(t?.clips[0].start).toBe(0);
  });

  it("says nothing at all on a lane with none", () => {
    // Absent rather than empty, so the wire and the eye both read "this lane has no takes".
    const d = compileNodeProject(
      project("bare", { events: [{ ref: "riff", start: "1:1:1" }] }),
    );
    expect(d.tracks.find((x) => x.id === "gtr")).not.toHaveProperty("takes");
  });
});

describe("withoutTakes", () => {
  it("strips them, and leaves everything else where it was", () => {
    const d = compileNodeProject(
      project("stripped", {
        events: [{ ref: "riff", start: "1:1:1" }],
        takes: [{ name: "one", events: [{ ref: "riff", start: "5:1:1" }] }],
      }),
    );
    const out = withoutTakes(d);
    const t = out.tracks.find((x) => x.id === "gtr");
    expect(t).not.toHaveProperty("takes");
    expect(t?.clips).toHaveLength(1);
    expect(out.tracks).toHaveLength(d.tracks.length);
  });

  it("is the SAME document when nothing has a take — the engine sees no churn", () => {
    const d = compileNodeProject(
      project("none", { events: [{ ref: "riff", start: "1:1:1" }] }),
    );
    expect(withoutTakes(d)).toBe(d);
  });
});

describe("takes belong to the alternative they were played in", () => {
  it("compiles the SET's takes, not the module's", () => {
    const d = compileNodeProject(
      project("alt", {
        events: [{ ref: "riff", start: "1:1:1" }],
        takes: [{ events: [{ ref: "riff", start: "5:1:1" }] }],
        alternative: "loud",
        alternatives: [
          {
            name: "loud",
            events: [{ ref: "riff", start: "1:1:1" }],
            takes: [
              { events: [{ ref: "riff", start: "9:1:1" }] },
              { events: [{ ref: "riff", start: "13:1:1" }] },
            ],
          },
        ],
      }),
    );
    const t = d.tracks.find((x) => x.id === "gtr");
    expect(t?.takes).toHaveLength(2);
    expect(t?.takes?.map((k) => k.clips[0].start)).toEqual([32, 48]);
  });
});
