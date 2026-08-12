// What the bench must be for l8 to open it at all: a project that COMPILES, with a chain that
// already reaches the output. The rest of the bench is the catalogue, mirrored in by the file
// service — see packages/file-service/src/bench.ts.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { projectModeOf } from "./projectMode";
import {
  BENCH_EDGES,
  BENCH_MODE_LINE,
  benchFiles,
  scaffoldBench,
} from "./scaffoldBench";
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

  it("declares no instance but its LANE", () => {
    // Two reasons, and both matter. A bench that arrived with the catalogue already in its
    // chains would instantiate every plugin in the médiathèque on open — the load this engine
    // was just hardened against. And an instance may not take a module's name, so once the
    // catalogue is mirrored into `modules/` every name in it is spoken for: a chain names the
    // MODULE here, which is also what makes the builder's lookup work.
    //
    // The one exception is the bench's own lane, which is an instance because every lane is
    // (docs/trackModules.md) — and `banc` is not a plugin's name.
    const instances = Object.keys(benchFiles("banc")).filter((p) =>
      p.startsWith("instances/"),
    );
    expect(instances).toEqual(["instances/banc.yaml"]);
  });

  it("carries the marker, and the marker survives the schema", () => {
    // `ProjectSettingsSchema` is `.strict()`, so an undeclared marker would not be a no-op —
    // it would make the bench the one project that refuses to open.
    const raw = readFileSync(join(dir, "project.yaml"), "utf8");
    expect(raw).toContain("mediatekBench: true");
  });

  it("is a LIVE project — a graph, and no timeline", () => {
    // banc.md said this before the field existed: « pas un morceau ». Nothing is arranged and
    // nothing is recorded here, so a bench that opened with a timeline over the graph would be
    // giving half the window to a pane that can never have anything in it.
    expect(readFileSync(join(dir, "project.yaml"), "utf8")).toContain(
      BENCH_MODE_LINE,
    );
    expect(projectModeOf(dir)).toBe("live");
    expect(compileNodeProject(dir).mode).toBe("live");
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
    expect(files[`instances/${BENCH_EDGES.track}.yaml`]).toBeDefined();
    expect(files[`modules/io/${BENCH_EDGES.out}/module.yaml`]).toBeDefined();
    expect(
      files[`modules/audio/${BENCH_EDGES.strip}/module.yaml`],
    ).toBeDefined();
    expect(files["chains.yaml"]).toContain(
      `${BENCH_EDGES.strip}: [ ${BENCH_EDGES.out} ]`,
    );
  });
});
