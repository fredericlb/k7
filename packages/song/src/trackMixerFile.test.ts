// A lane's strip. Two things would be wrong silently: a mixer spliced anywhere but LAST (the level
// would sit before what makes the sound, and `trackMixer` reads the last one), and a run that ends
// somewhere other than the sum being rewritten on a guess.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { trackMixer } from "./project";
import {
  addTrackMixer,
  hasTrackMixer,
  mixerNameFor,
  planTrackMixer,
} from "./trackMixerFile";

let dir: string;

const graph = (body: string): void =>
  writeFileSync(join(dir, "graph.yaml"), body, "utf8");
const lane = (id: string): void =>
  writeFileSync(
    join(dir, "nodes", `${id}.yaml`),
    'extends: "@studio/track"\nevents: []\n',
    "utf8",
  );
const module_ = (name: string, plugin: string): void => {
  mkdirSync(join(dir, "modules", "audio", name), { recursive: true });
  writeFileSync(
    join(dir, "modules", "audio", name, "module.yaml"),
    `plugin:\n  type: internal\n  name: ${plugin}\n`,
    "utf8",
  );
};
const graphText = () => readFileSync(join(dir, "graph.yaml"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-strip-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("mixerNameFor", () => {
  it("names the lane, and steps aside for a name already taken", () => {
    expect(mixerNameFor("pad", () => false)).toBe("mix-pad");
    expect(mixerNameFor("pad", (n) => n === "mix-pad")).toBe("mix-pad-2");
  });
});

describe("planTrackMixer", () => {
  it("wires an ORPHAN lane straight to the sum, since it is in no chain at all", () => {
    lane("kit");
    graph("modules:\n  MIX: [ OUT ]\n");
    const plan = planTrackMixer(dir, "kit", loadGraph(dir));
    expect(plan).toMatchObject({ name: "mix-kit", after: null });
  });

  it("splices after the LAST module of a run, so the level sits past the sound", () => {
    lane("pad");
    module_("synth-pad", "4osc");
    graph(
      "modules:\n  pad: [ synth-pad ]\n  synth-pad: [ MIX ]\n  MIX: [ OUT ]\n",
    );
    expect(planTrackMixer(dir, "pad", loadGraph(dir))).toMatchObject({
      name: "mix-pad",
      after: "synth-pad",
    });
  });

  it("answers null for a lane that already ends on one — the migration is idempotent", () => {
    lane("pad");
    module_("mix-pad", "Mixer");
    graph("modules:\n  pad: [ mix-pad ]\n  mix-pad: [ MIX ]\n  MIX: [ OUT ]\n");
    const g = loadGraph(dir);
    expect(hasTrackMixer(g, "pad")).toBe(true);
    expect(planTrackMixer(dir, "pad", g)).toBeNull();
  });

  it("refuses a run that ends somewhere other than the sum rather than guessing", () => {
    lane("pad");
    lane("kit");
    module_("verb", "Reverb");
    module_("bus", "Mixer");
    // A real BUS: two lanes MEET at it, so each run ends before it and neither reaches the sum
    // itself. Splicing a strip in there would rewrite somebody's own arrangement.
    graph(
      "modules:\n  pad: [ verb ]\n  kit: [ verb ]\n  verb: [ bus ]\n  bus: [ MIX ]\n  MIX: [ OUT ]\n",
    );
    expect(() => planTrackMixer(dir, "pad", loadGraph(dir))).toThrow(
      /does not run into MIX/,
    );
  });
});

describe("addTrackMixer", () => {
  it("writes the module and one arrow, and the lane then HAS a mixer when compiled", () => {
    lane("pad");
    module_("synth-pad", "4osc");
    graph(
      "# the graph\nmodules:\n  pad: [ synth-pad ]\n  synth-pad: [ MIX ]\n  MIX: [ OUT ]\n",
    );
    const files = addTrackMixer(dir, "pad", loadGraph(dir));
    expect(files).toEqual(["modules/audio/mix-pad/module.yaml", "graph.yaml"]);
    // The splice, not an append: the synth now feeds the strip and the strip feeds the sum.
    expect(graphText()).toContain("synth-pad: [ mix-pad ]");
    expect(graphText()).toContain("mix-pad: [ MIX ]");
    // …and the file's comments survive, this being a Document edit rather than a re-serialisation.
    expect(graphText()).toContain("# the graph");
    const t = compileNodeProject(dir).tracks.find((x) => x.id === "pad");
    expect(trackMixer(t as never)?.name).toBe("mix-pad");
  });

  it("is a no-op the second time", () => {
    lane("kit");
    graph("modules:\n  MIX: [ OUT ]\n");
    addTrackMixer(dir, "kit", loadGraph(dir));
    const after = graphText();
    expect(addTrackMixer(dir, "kit", loadGraph(dir))).toBeNull();
    expect(graphText()).toBe(after);
  });
});
