// A subchain RUN in place (`{ sub }`, docs/chainFiles.md): a stretch of its parent's run, compiled
// there, written back there after a graph edit, and what `stackChainNode` makes or grows.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  insertBetween,
  setModuleEnabled,
} from "@studio/song-schema/yaml/graphFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editChainGraph } from "./chainGraphEdit";
import { readChainProject, readLayout, toSegments } from "./chainProject";
import { stackChainNode } from "./chainStack";
import { nodeStacks } from "./nodePlace";
import { wsData } from "./yaml/workspaceDoc";

const AMP = '"@k7-core/audio/amp"';
const GTR = [
  "start(true)",
  "steps([",
  '  id("lane-gtr").track("gtr"),',
  '  sub("amp"),',
  `  id("strip-1").extends(${AMP}),`,
  '  to([chain("MIX")]),',
  "])",
  "subchains([",
  '  id("amp").steps([',
  `    id("amp-1").extends(${AMP}),`,
  `    id("eq-1").extends(${AMP}),`,
  "  ]),",
  "])",
  "",
].join("\n");

const issuesOf = (text: string) =>
  parseChain(text)
    .issues.map((i) => i.message)
    .join(" ");

describe("a `{ sub }` step", () => {
  it("parses, and names a subchain of its file that has no `to:` and is linked by nothing", () => {
    expect(parseChain(GTR).issues).toEqual([]);
    expect(issuesOf(GTR.replace('sub("amp")', 'sub("nope")'))).toMatch(
      /no subchain "nope"/,
    );
    const back = GTR.replace(
      `    id("eq-1").extends(${AMP}),\n`,
      `    id("eq-1").extends(${AMP}),\n    to([chain("MIX")]),\n`,
    );
    expect(issuesOf(back)).toMatch(/returns to its parent/);
    const twice = GTR.replace(
      `  id("strip-1").extends(${AMP}),`,
      '  sub("amp"),',
    );
    expect(issuesOf(twice)).toMatch(/run twice/);
  });

  it("is never the first step", () => {
    const first = GTR.replace("start(true)\n", "").replace(
      '  id("lane-gtr").track("gtr"),\n',
      "",
    );
    expect(issuesOf(first)).toMatch(/first step is one node/);
  });
});

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
// biome-ignore lint/suspicious/noExplicitAny: the tests reach into the file's data by shape.
const chain = (name: string): any => wsData(join(dir, "chains", `${name}.k7x`));
const segments = () =>
  toSegments(readChainProject(dir), readLayout(dir)).graph.modules ?? {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chain-stack-"));
  dir = join(root, "song");
  put("project.k7x", 'project({ name: "t", tempo: 120 })\n');
  put("tracks/gtr.k7x", 'extends("@meta/track")\nevents([])\n');
  put("chains/gtr.k7x", GTR);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a project running a subchain in place", () => {
  it("compiles the subchain into its parent's run, in series", () => {
    const m = segments();
    expect(m.gtr).toEqual(["amp-1"]);
    expect(m["amp-1"]).toEqual(["eq-1"]);
    expect(m["eq-1"]).toEqual(["strip-1"]);
    expect(m["strip-1"]).toEqual(["MIX"]);
    expect(nodeStacks(dir)).toEqual([["amp-1", "eq-1"]]);
  });

  it("writes the stretch back as the same `{ sub }` after an edit elsewhere", () => {
    editChainGraph(dir, (t) => setModuleEnabled(t, "strip-1", false));
    const gtr = chain("gtr");
    expect(gtr.steps[1]).toEqual({ sub: "amp" });
    expect(gtr.subchains[0].steps.map((s: { id: string }) => s.id)).toEqual([
      "amp-1",
      "eq-1",
    ]);
    expect(gtr.steps[2].bypass).toBe(true);
  });

  it("keeps a node inserted between two members inside the stretch, and one inserted after it outside", () => {
    const item = (id: string) =>
      ({ id, extends: "@k7-core/audio/amp" }) as never;
    editChainGraph(dir, (t) => insertBetween(t, "amp-1", "eq-1", "mid-1"), {
      add: { "mid-1": item("mid-1") },
    });
    editChainGraph(dir, (t) => insertBetween(t, "eq-1", "strip-1", "post-1"), {
      add: { "post-1": item("post-1") },
    });
    const gtr = chain("gtr");
    expect(gtr.subchains[0].steps.map((s: { id: string }) => s.id)).toEqual([
      "amp-1",
      "mid-1",
      "eq-1",
    ]);
    expect(
      gtr.steps.map((s: { id?: string; sub?: string }) => s.id ?? s.sub),
    ).toEqual(["lane-gtr", "amp", "post-1", "strip-1", undefined]);
  });
});

describe("stackChainNode", () => {
  beforeEach(() => {
    put(
      "chains/gtr.k7x",
      `start(true)\nsteps([\n  id("lane-gtr").track("gtr"),\n  id("amp-1").extends(${AMP}),\n  id("strip-1").extends(${AMP}),\n  to([chain("MIX")]),\n])\n`,
    );
    put("chains/eq.k7x", 'steps([id("eq-1").extends("@k7-core/audio/eq")])\n');
    put("layout.k7x", 'positions({ "eq-1": { x: 10, y: 20 } })\n');
  });

  it("wraps the node above and the new one in a subchain run in that one's place", () => {
    stackChainNode(dir, "amp-1", "eq-1");
    const gtr = chain("gtr");
    expect(gtr.steps[1]).toEqual({ sub: "amp" });
    expect(gtr.subchains).toEqual([
      {
        id: "amp",
        steps: [
          { id: "amp-1", extends: "@k7-core/audio/amp" },
          { id: "eq-1", extends: "@k7-core/audio/eq" },
        ],
      },
    ]);
    expect(Object.keys(readChainProject(dir).chains)).toEqual(["gtr"]);
    expect(readLayout(dir)["eq-1"]).toBeUndefined();
    expect(segments()["amp-1"]).toEqual(["eq-1"]);
  });

  it("puts a node stacked under a member into that subchain, right under it", () => {
    stackChainNode(dir, "amp-1", "eq-1");
    put(
      "chains/gate.k7x",
      'steps([id("gate-1").extends("@k7-core/audio/gate")])\n',
    );
    stackChainNode(dir, "amp-1", "gate-1");
    const gtr = chain("gtr");
    expect(gtr.subchains).toHaveLength(1);
    expect(gtr.subchains[0].steps.map((s: { id: string }) => s.id)).toEqual([
      "amp-1",
      "gate-1",
      "eq-1",
    ]);
  });

  it("refuses under a lane, and a node already wired", () => {
    expect(() => stackChainNode(dir, "gtr", "eq-1")).toThrow(/lane/);
    expect(() => stackChainNode(dir, "amp-1", "strip-1")).toThrow(
      /already wired/,
    );
  });
});
