// Creating in a CHAIN project (docs/chainFiles.md): a node is a loose chain's one item, hidden until
// placed; a lane is its `tracks/` file and a `start: true` chain; and editing an item cannot touch
// the use's own keys.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAssembly } from "./assemblyEdit";
import {
  chainGraphText,
  chainNodeName,
  editChainGraph,
} from "./chainGraphEdit";
import { spliceChainItem } from "./chainItemEdit";
import { readChainProject, readLayout, toSegments } from "./chainProject";
import type { GraphDoc } from "./graph";
import { applyLaneStrip, planLaneStrip } from "./laneStrip";
import { createIoModuleFile, createTrackFile, nodeNameTaken } from "./loader";
import { materialiseEngineModule } from "./moduleFork";
import { createNodeOn } from "./nodeOnRef";
import type { LoadedModule } from "./rawDoc";
import { ensureVideoRun } from "./videoOutputs";
import { wsData } from "./yaml/workspaceDoc";

let root: string; // the workspace, so a module given a folder lands in its `_modules`
let dir: string;
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
// biome-ignore lint/suspicious/noExplicitAny: the tests reach into the file's data by shape.
const data = (rel: string): any => wsData(join(dir, rel));
const visible = () =>
  toSegments(readChainProject(dir), readLayout(dir)).graph.modules ?? {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chain-write-"));
  dir = join(root, "song");
  mkdirSync(join(dir, "chains"), { recursive: true });
  writeFileSync(
    join(dir, "project.k7x"),
    'project({ name: "t", tempo: 120 })\n',
  );
  writeFileSync(
    join(dir, "chains", "master.k7x"),
    'start("MIX")\nsteps([to([chain("OUT")])])\n',
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a new node", () => {
  const REFS = {
    "@k7-core/audio/delay": { kind: "plugin" },
  } as unknown as Record<string, LoadedModule>;

  it("is the one item of a chain named as asked, known by its id, hidden until placed", () => {
    const id = createNodeOn(dir, "@k7-core/audio/delay", "echo", REFS);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data("chains/echo.k7x").steps[0].id).toBe(id);
    expect(readChainProject(dir).nodes[id]?.chain).toBe("echo");
    expect(visible()[id]).toBeUndefined();
    // The chain's name stands for its one node, which is how a caller holding the name places it.
    expect(chainNodeName(dir, "echo")).toBe(id);
  });

  it("refuses a name a chain already has, and the name counts as taken", () => {
    createNodeOn(dir, "@k7-core/audio/delay", "echo", REFS);
    expect(nodeNameTaken(dir)("echo")).toBe(true);
    expect(() =>
      createNodeOn(dir, "@k7-core/audio/delay", "echo", REFS),
    ).toThrow(/already exists/);
  });

  it("an input starts its chain once wired, keeping its role's description", () => {
    const id = createIoModuleFile(dir, "IN2", "in");
    expect(data("chains/IN2.k7x").steps[0].io).toBe("in");
    editChainGraph(dir, (t) => t.setIn(["modules", id], ["MIX"]));
    expect(data("chains/IN2.k7x").start).toBe(true);
    expect(read("chains/IN2.k7x")).toContain('// `monitor("auto")` is audible');
  });
});

describe("a new lane", () => {
  it("is tracks/<lane>.k7x and a chain that starts at it, given its strip before the sum", () => {
    expect(createTrackFile(dir, "gtr")).toEqual([
      "tracks/gtr.k7x",
      "chains/gtr.k7x",
    ]);
    expect(data("chains/gtr.k7x")).toMatchObject({
      start: true,
      steps: [expect.objectContaining({ track: "gtr" })],
    });
    const g = { chains: {}, modules: {} } as unknown as GraphDoc;
    const plan = planLaneStrip(dir, "gtr", g);
    expect(plan?.rel).toBe("chains/gtr.k7x");
    applyLaneStrip(dir, plan as NonNullable<typeof plan>);
    const steps = data("chains/gtr.k7x").steps;
    expect(steps).toContainEqual(
      expect.objectContaining({ extends: "@meta/audio/mixer" }),
    );
    expect(steps.at(-1).to).toContainEqual(
      expect.objectContaining({ chain: "MIX" }),
    );
    expect(visible().gtr).toEqual([plan?.name]);
  });
});

describe("the picture's run", () => {
  it("is a chain starting at RENDER, written once", () => {
    expect(ensureVideoRun(dir)).toBe(true);
    expect(data("chains/picture.k7x").start).toBe("RENDER");
    expect(ensureVideoRun(dir)).toBe(false);
    expect(chainGraphText(dir)).toContain("RENDER");
  });
});

describe("what a chain project refuses or repoints", () => {
  it("refuses an assembly", () => {
    expect(() => createAssembly(dir, "@lib/x", "box")).toThrow(/chain project/);
  });

  it("repoints the items extending an engine module given a folder", () => {
    writeFileSync(
      join(dir, "chains", "amp.k7x"),
      'steps([id("n1").extends("@engine/nam")])\n',
    );
    const r = materialiseEngineModule(dir, "@engine/nam", {
      "@engine/nam": {
        plugin: { type: "vst3", name: "NAM" },
        kind: "plugin",
        category: "audio",
        file: "nam",
      },
    } as unknown as Record<string, LoadedModule>);
    expect(r.chains).toEqual(["amp"]);
    expect(data("chains/amp.k7x").steps[0].extends).toBe(
      "@workspace/audio/nam",
    );
  });
});

describe("spliceChainItem", () => {
  const CHAIN =
    'steps([\n  // kept\n  id("a").extends("@k7-core/x").bypass(true),\n  id("b").extends("@k7-core/y"),\n])\n';

  it("edits one item as a node file, and puts the use's keys back", () => {
    const out = spliceChainItem(CHAIN, "a", (t) => {
      t.setIn(["bypass"], false);
      t.setIn(["mix"], 0.5);
    });
    expect(out).toContain("// kept");
    expect(parse(out).steps).toEqual([
      { id: "a", extends: "@k7-core/x", bypass: true, mix: 0.5 },
      { id: "b", extends: "@k7-core/y" },
    ]);
    expect(out).toContain('  id("b").extends("@k7-core/y"),\n');
  });

  it("refuses an edit that leaves the chain unreadable", () => {
    expect(() =>
      spliceChainItem(CHAIN, "b", (t) => t.setIn(["params"], 3)),
    ).toThrow(/unreadable/);
    expect(existsSync(dir)).toBe(true);
  });
});
