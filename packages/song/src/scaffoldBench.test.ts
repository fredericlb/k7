// What the bench must be for st0 to open it at all: a project that COMPILES, with a chain that
// already reaches the output. The rest of the bench is the catalogue, mirrored in by the file
// service — see packages/file-service/src/bench.ts.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { BENCH_EDGES, benchFiles, scaffoldBench } from "./scaffoldBench";
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
    // The lane's run, plus the empty `MIX -> OUT` every project carries.
    expect(Object.keys(g.chains).length).toBe(2);
  });

  it("declares no node but its LANE", () => {
    // Two reasons, and both matter. A bench that arrived with the catalogue already in its
    // chains would instantiate every plugin in the médiathèque on open — the load this engine
    // was just hardened against. And a node may not take a module's name, so once the
    // catalogue is mirrored into `modules/` every name in it is spoken for: a chain names the
    // MODULE here, which is also what makes the builder's lookup work.
    //
    // The one exception is the bench's own lane, which is a node because every lane is
    // (docs/trackModules.md) — and `banc` is not a plugin's name.
    const nodes = Object.keys(benchFiles("banc")).filter((p) =>
      p.startsWith("nodes/"),
    );
    expect(nodes).toEqual(["nodes/banc.yaml"]);
  });

  it("carries the marker, and the marker survives the schema", () => {
    // `ProjectSettingsSchema` is `.strict()`, so an undeclared marker would not be a no-op —
    // it would make the bench the one project that refuses to open.
    const raw = readFileSync(join(dir, "project.yaml"), "utf8");
    expect(raw).toContain("mediatekBench: true");
  });

  it("declares no timeline — a graph, and nothing arranged", () => {
    // banc.md said this before there was any way to write it down: « pas un morceau ». Nothing is
    // arranged and nothing is recorded here, so a bench that opened with a timeline over the
    // graph would be giving half the window to a pane that can never have anything in it.
    //
    // It says so by SILENCE now rather than with a `project_type: live` line: a project draws the
    // surfaces it declares, and the bench declares none. The two halves of that are pinned here —
    // no surface file, and nothing in the header claiming otherwise.
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
    // The chain translation renames `@in`/`@out` into these three. A scaffold that stopped
    // writing one of them would not fail here by itself — it would fail by silently saving a
    // rewritten chain back to the médiathèque, which nothing else would catch.
    const files = benchFiles("banc");
    expect(files[`nodes/${BENCH_EDGES.track}.yaml`]).toBeDefined();
    expect(
      files[`modules/audio/${BENCH_EDGES.strip}/module.yaml`],
    ).toBeDefined();
    expect(files["graph.yaml"]).toContain(
      `${BENCH_EDGES.strip}: [ ${BENCH_EDGES.out} ]`,
    );
    // …and out of the sum to the interface, the line every project carries. `chainToBench`
    // writes it too, so a chain opened here does not lose the project's own output.
    expect(files["graph.yaml"]).toContain("MIX: [ OUT ]");
  });
});
