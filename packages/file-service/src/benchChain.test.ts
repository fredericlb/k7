// The bench opened ON a library chain — k7's chain source. What is proved: the chain lands between
// the input and the fader in either layout, a cold chain is listed but refused, and the library is
// never written.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rootDir } from "@studio/engine-client/paths";
import { chainSteps } from "@studio/song/chainsGraph";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import { BENCH_PROJECT, benchProject } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { liveChains } from "./benchChain.ts";

const EMAIL = "someone@example.test";
const PINNED_HOME = process.env.STUDIO_HOME;
let home: string;

const benchRoot = (): string => join(rootDir(), BENCH_WORKSPACE);
const benchDir = (): string => join(benchRoot(), BENCH_PROJECT);
/** The account's `k7-core` library, where the file service clones it — under `$STUDIO_HOME`. */
const library = (rel: string): string =>
  join(home, "libraries", "k7-core", rel);

const put = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(library(rel), value);

/** The bench's graph segments, as data. */
const benchGraph = () => {
  const text = readFileSync(join(benchDir(), "graph.k7x"), "utf8");
  return { text, graph: parseGraph(text).value };
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-bench-chain-"));
  process.env.STUDIO_HOME = home;
  put("modules/audio/comp/module.k7x", {
    plugin: { type: "internal", name: "Compressor" },
  });
  put("modules/audio/eq/module.k7x", {
    plugin: { type: "internal", name: "4Band EQ" },
  });
  put("modules/audio/normalize/module.k7x", {
    cold: true,
    plugin: { type: "internal", name: "Normalize" },
  });
  put("chains/vocals/warm/graph.k7x", {
    modules: { "@in": ["comp"], comp: ["eq"], eq: ["@out"] },
  });
  put("chains/vocals/warm/nodes/comp.k7x", { extends: "@k7-core/audio/comp" });
  put("chains/vocals/warm/nodes/eq.k7x", { extends: "@k7-core/audio/eq" });
  put("chains/master/norm/graph.k7x", {
    modules: { "@in": ["norm"], norm: ["@out"] },
  });
  put("chains/master/norm/nodes/norm.k7x", {
    extends: "@k7-core/audio/normalize",
  });
  // The same chain as a FILE: nodes inline, named by id, and a preset in the library's vstpresets/.
  put("chains/vocals/bright.k7x", {
    steps: [
      { id: "a1", extends: "@k7-core/audio/comp", params: { Ratio: 0.5 } },
      { id: "b2", extends: "@k7-core/audio/eq", bypass: true },
      { to: [{ chain: "@out" }] },
    ],
  });
  mkdirSync(dirname(library("vstpresets/a1.vstpreset")), { recursive: true });
  writeFileSync(library("vstpresets/a1.vstpreset"), "state", "utf8");
});

afterEach(() => {
  process.env.STUDIO_HOME = PINNED_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("the bench, on a library chain", () => {
  it("lists every chain, refusing a cold one by name", () => {
    const chains = liveChains(benchDir());
    expect(chains.map((c) => c.ref)).toEqual([
      "@k7-core/master/norm",
      "@k7-core/vocals/bright",
      "@k7-core/vocals/warm",
    ]);
    expect(chains[0].unavailable).toContain("on disk");
    expect(chains[1].unavailable).toBeNull();
    expect(chains[2].unavailable).toBeNull();
  });

  it("puts the chain between the input and the fader, the rest of the rig untouched", async () => {
    await ensureBench(EMAIL, benchProject("vocals/warm"));
    const { text, graph } = benchGraph();
    expect(graph?.modules).toMatchObject({
      IN: ["comp"],
      eq: ["fader"],
      MIX: ["rec"],
    });
    expect(text).not.toContain("@in");
    expect(chainSteps(text)).toEqual(
      expect.arrayContaining(["comp", "eq", "fader"]),
    );
    expect(readdirSync(join(benchDir(), "nodes"))).toEqual(
      expect.arrayContaining(["comp.k7x", "eq.k7x", "fader.k7x"]),
    );
  });

  it("copies a chain FILE as the bench's own segments and node files, named after their modules", async () => {
    await ensureBench(EMAIL, benchProject("vocals/bright"));
    const { graph } = benchGraph();
    expect(graph?.modules).toMatchObject({
      IN: ["comp"],
      comp: ["eq"],
      eq: ["fader"],
    });
    expect(graph?.bypassed).toEqual(["eq"]);
    expect(wsData(join(benchDir(), "nodes", "comp.k7x")).params).toEqual({
      Ratio: 0.5,
    });
    expect(
      readFileSync(join(benchDir(), "nodes", "comp.vstpreset"), "utf8"),
    ).toBe("state");
  });

  it("refuses a chain that cannot run live, and one the library does not hold", async () => {
    await expect(
      ensureBench(EMAIL, benchProject("master/norm")),
    ).rejects.toThrow(/cannot run live/);
    await expect(ensureBench(EMAIL, benchProject("nope"))).rejects.toThrow(
      /no chain/,
    );
  });

  it("copies the chain and never writes the library, which no chain's bench may edit", async () => {
    const before = readFileSync(
      library("chains/vocals/warm/graph.k7x"),
      "utf8",
    );
    await ensureBench(EMAIL, benchProject("vocals/warm"));
    await ensureBench(EMAIL, benchProject("vocals/warm"));
    expect(readFileSync(library("chains/vocals/warm/graph.k7x"), "utf8")).toBe(
      before,
    );
  });
});
