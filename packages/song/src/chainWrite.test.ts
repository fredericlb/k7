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
import { createIoModuleFile, createTrackFile, nodeNameTaken } from "./loader";
import { materialiseEngineModule } from "./moduleFork";
import { createNodeOn } from "./nodeOnRef";
import type { LoadedModule } from "./rawDoc";
import { applyTrackMixer, planTrackMixer } from "./trackMixerFile";
import { ensureVideoRun } from "./videoOutputs";

let root: string; // the workspace, so a module given a folder lands in its `_modules`
let dir: string;
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
const visible = () =>
  toSegments(readChainProject(dir), readLayout(dir)).graph.modules ?? {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chain-write-"));
  dir = join(root, "song");
  mkdirSync(join(dir, "chains"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
  );
  writeFileSync(
    join(dir, "chains", "master.yaml"),
    "start: MIX\nsteps:\n  - to:\n      - { chain: OUT }\n",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a new node", () => {
  const REFS = { "@st0/audio/delay": { kind: "plugin" } } as unknown as Record<
    string,
    LoadedModule
  >;

  it("is the one item of a chain named as asked, known by its id, hidden until placed", () => {
    const id = createNodeOn(dir, "@st0/audio/delay", "echo", REFS);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(read("chains/echo.yaml")).toContain(`id: ${id}`);
    expect(readChainProject(dir).nodes[id]?.chain).toBe("echo");
    expect(visible()[id]).toBeUndefined();
    // The chain's name stands for its one node, which is how a caller holding the name places it.
    expect(chainNodeName(dir, "echo")).toBe(id);
  });

  it("refuses a name a chain already has, and the name counts as taken", () => {
    createNodeOn(dir, "@st0/audio/delay", "echo", REFS);
    expect(nodeNameTaken(dir)("echo")).toBe(true);
    expect(() => createNodeOn(dir, "@st0/audio/delay", "echo", REFS)).toThrow(
      /already exists/,
    );
  });

  it("an input starts its chain once wired, keeping its role's comments", () => {
    const id = createIoModuleFile(dir, "IN2", "in");
    expect(read("chains/IN2.yaml")).toContain("io: in");
    editChainGraph(dir, (t) =>
      t.replace("modules:", `modules:\n  ${id}: [ MIX ]`),
    );
    expect(read("chains/IN2.yaml")).toMatch(/^start: true/m);
    expect(read("chains/IN2.yaml")).toContain("# …and a trim in dB");
  });
});

describe("a new lane", () => {
  it("is tracks/<lane>.yaml and a chain that starts at it, given its strip before the sum", () => {
    expect(createTrackFile(dir, "gtr")).toEqual([
      "tracks/gtr.yaml",
      "chains/gtr.yaml",
    ]);
    expect(read("chains/gtr.yaml")).toMatch(/start: true[\s\S]*track: "?gtr"?/);
    const g = { chains: {}, modules: {} } as unknown as GraphDoc;
    const plan = planTrackMixer(dir, "gtr", g);
    expect(plan?.rel).toBe("chains/gtr.yaml");
    applyTrackMixer(dir, plan as NonNullable<typeof plan>);
    const text = read("chains/gtr.yaml");
    expect(text).toContain('extends: "@meta/audio/mixer"');
    expect(text).toContain("chain: MIX");
    expect(visible().gtr).toEqual([plan?.name]);
  });
});

describe("the picture's run", () => {
  it("is a chain starting at RENDER, written once", () => {
    expect(ensureVideoRun(dir)).toBe(true);
    expect(read("chains/picture.yaml")).toContain("start: RENDER");
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
      join(dir, "chains", "amp.yaml"),
      'steps:\n  - id: n1\n    extends: "@engine/nam"\n',
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
    expect(read("chains/amp.yaml")).toContain(
      'extends: "@workspace/audio/nam"',
    );
  });
});

describe("spliceChainItem", () => {
  const CHAIN =
    'steps:\n  # kept\n  - { id: a, extends: "@st0/x", bypass: true }\n  - id: b\n    extends: "@st0/y"\n';

  it("edits one item as a node file, block style, and puts the use's keys back", () => {
    const out = spliceChainItem(CHAIN, "a", (t) =>
      t.replace("bypass: true", "bypass: false").concat("mix: 0.5\n"),
    );
    expect(out).toContain("# kept");
    expect(out).toMatch(
      /id: a\n\s+extends: "@st0\/x"\n\s+bypass: true\n\s+mix: 0.5/,
    );
    expect(out).toContain('  - id: b\n    extends: "@st0/y"\n');
  });

  it("refuses an edit that leaves the chain unreadable", () => {
    expect(() => spliceChainItem(CHAIN, "b", (t) => `${t}params: 3\n`)).toThrow(
      /unreadable/,
    );
    expect(existsSync(dir)).toBe(true);
  });
});
