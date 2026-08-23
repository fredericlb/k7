// What the bench must be for st0 to open it at all: a project that COMPILES, with a chain that
// already reaches the output. The rest of the bench is the catalogue, mirrored in by the file
// service — see packages/file-service/src/bench.ts.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFileSchema } from "@studio/song-schema/yaml/projectSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { BENCH_EDGES, benchFiles, scaffoldBench } from "./scaffoldBench";

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
    // A warning means the bench references something it did not write, for every user at once.
    expect(g.warnings).toEqual([]);
    // The lane's run, plus the empty `MIX -> OUT` every project carries.
    expect(Object.keys(g.chains).length).toBe(2);
  });

  it("declares no node but its LANE", () => {
    // Nodes would instantiate the whole catalogue on open, and every mirrored name is taken.
    const nodes = Object.keys(benchFiles("banc")).filter((p) =>
      p.startsWith("nodes/"),
    );
    expect(nodes).toEqual(["nodes/banc.yaml"]);
  });

  it("carries the marker, and the marker survives the schema", () => {
    // `ProjectSettingsSchema` is `.strict()`, so an undeclared marker refuses to open the bench.
    const raw = readFileSync(join(dir, "project.yaml"), "utf8");
    expect(raw).toContain("mediatekBench: true");
  });

  it("declares no timeline — a graph, and nothing arranged", () => {
    // Said by SILENCE rather than `project_type: live`: a project draws the surfaces it declares.
    expect(existsSync(join(dir, "surfaces"))).toBe(false);
    expect(readFileSync(join(dir, "project.yaml"), "utf8")).not.toContain(
      "project_type",
    );
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

  it("is the furniture BENCH_EDGES names", () => {
    // Drop one and the failure is a rewritten chain saved back to the médiathèque, silently.
    const files = benchFiles("banc");
    expect(files[`nodes/${BENCH_EDGES.track}.yaml`]).toBeDefined();
    expect(
      files[`modules/audio/${BENCH_EDGES.strip}/module.yaml`],
    ).toBeDefined();
    expect(files["graph.yaml"]).toContain(
      `${BENCH_EDGES.strip}: [ ${BENCH_EDGES.out} ]`,
    );
    // …and out of the sum, which `chainToBench` writes too so a chain keeps the output.
    expect(files["graph.yaml"]).toContain("MIX: [ OUT ]");
  });
});
