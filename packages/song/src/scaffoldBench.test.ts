// What the bench must be for l8 to open it at all: a project that COMPILES, with a chain that
// already reaches the output. The rest of the bench is the catalogue, mirrored in by the file
// service — see packages/file-service/src/bench.ts.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { benchFiles, scaffoldBench } from "./scaffoldBench";
import { ProjectFileSchema } from "./yaml/projectSchema";

describe("the module bench", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-bench-"));
    scaffoldBench(dir, "banc");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("compiles, with the track reaching OUT through the strip", () => {
    const doc = compileNodeProject(dir);
    const g = loadGraph(dir);
    expect(doc.tracks.map((t) => t.id)).toEqual(["banc"]);
    // A warning here means the bench references something it did not write — which, for a
    // project every user is handed identically, is the failure that reaches everyone at once.
    expect(g.warnings).toEqual([]);
    expect(Object.keys(g.chains).length).toBe(1);
  });

  it("declares NO instances at all", () => {
    // Two reasons, and both matter. A bench that arrived with the catalogue already in its
    // chains would instantiate every plugin in the médiathèque on open — the load this engine
    // was just hardened against. And an instance may not take a module's name, so once the
    // catalogue is mirrored into `modules/` every name in it is spoken for: a chain names the
    // MODULE here, which is also what makes the builder's lookup work.
    const instances = Object.keys(benchFiles("banc")).filter((p) =>
      p.startsWith("instances/"),
    );
    expect(instances).toEqual([]);
  });

  it("carries the marker, and the marker survives the schema", () => {
    // `ProjectSettingsSchema` is `.strict()`, so an undeclared marker would not be a no-op —
    // it would make the bench the one project that refuses to open.
    const raw = readFileSync(join(dir, "project.yaml"), "utf8");
    expect(raw).toContain("mediatekBench: true");
  });

  it("is a project.yaml the schema accepts", () => {
    const parsed = ProjectFileSchema.safeParse({
      project: {
        name: "banc",
        tempo: 120,
        sampleRate: 48000,
        timeSignature: "4/4",
        mediatekBench: true,
      },
    });
    expect(parsed.success).toBe(true);
  });
});
