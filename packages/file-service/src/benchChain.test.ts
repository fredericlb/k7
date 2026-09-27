// The bench opened ON a library chain — k7's chain source. What is proved: the chain lands between
// the input and the fader, a cold chain is listed but refused, and the library is never written.

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
import { BENCH_PROJECT } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { liveChains } from "./benchChain.ts";

const EMAIL = "someone@example.test";
const LIBRARIES_URI = "git@example.test:studio/libraries.git";
const PINNED_HOME = process.env.STUDIO_HOME;
let home: string;

const benchRoot = (): string => join(rootDir(), BENCH_WORKSPACE);
const benchDir = (): string => join(benchRoot(), BENCH_PROJECT);
const library = (rel: string): string => join(benchRoot(), "_libraries", rel);

const put = (rel: string, text: string): void => {
  mkdirSync(dirname(library(rel)), { recursive: true });
  writeFileSync(library(rel), text, "utf8");
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-bench-chain-"));
  process.env.STUDIO_HOME = home;
  put(
    "modules/audio/comp/module.yaml",
    "plugin:\n  type: internal\n  name: Compressor\n",
  );
  put(
    "modules/audio/eq/module.yaml",
    "plugin:\n  type: internal\n  name: 4Band EQ\n",
  );
  put(
    "modules/audio/normalize/module.yaml",
    "cold: true\nplugin:\n  type: internal\n  name: Normalize\n",
  );
  put(
    "chains/vocals/warm/graph.yaml",
    'modules:\n  "@in": [ comp ]\n  comp: [ eq ]\n  eq: [ "@out" ]\n',
  );
  put("chains/vocals/warm/nodes/comp.yaml", 'extends: "@st0/audio/comp"\n');
  put("chains/vocals/warm/nodes/eq.yaml", 'extends: "@st0/audio/eq"\n');
  put(
    "chains/master/norm/graph.yaml",
    'modules:\n  "@in": [ norm ]\n  norm: [ "@out" ]\n',
  );
  put(
    "chains/master/norm/nodes/norm.yaml",
    'extends: "@st0/audio/normalize"\n',
  );
});

afterEach(() => {
  process.env.STUDIO_HOME = PINNED_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("the bench, on a library chain", () => {
  it("lists every chain, refusing a cold one by name", () => {
    const chains = liveChains(benchDir());
    expect(chains.map((c) => c.ref)).toEqual(["master/norm", "vocals/warm"]);
    expect(chains[0].unavailable).toContain("on disk");
    expect(chains[1].unavailable).toBeNull();
  });

  it("puts the chain between the input and the fader, the rest of the rig untouched", async () => {
    await ensureBench(EMAIL, LIBRARIES_URI, "vocals/warm");
    const graph = readFileSync(join(benchDir(), "graph.yaml"), "utf8");
    expect(graph).toContain("IN: [ comp ]");
    expect(graph).toContain("eq: [ fader ]");
    expect(graph).toContain("MIX: [ rec ]");
    expect(graph).not.toContain("@in");
    expect(chainSteps(graph)).toEqual(
      expect.arrayContaining(["comp", "eq", "fader"]),
    );
    expect(readdirSync(join(benchDir(), "nodes"))).toEqual(
      expect.arrayContaining(["comp.yaml", "eq.yaml", "fader.yaml"]),
    );
  });

  it("refuses a chain that cannot run live, and one the library does not hold", async () => {
    await expect(
      ensureBench(EMAIL, LIBRARIES_URI, "master/norm"),
    ).rejects.toThrow(/cannot run live/);
    await expect(ensureBench(EMAIL, LIBRARIES_URI, "nope")).rejects.toThrow(
      /no chain/,
    );
  });

  it("is gone at the next open with no chain, and the library was never written", async () => {
    const before = readFileSync(
      library("chains/vocals/warm/graph.yaml"),
      "utf8",
    );
    await ensureBench(EMAIL, LIBRARIES_URI, "vocals/warm");
    await ensureBench(EMAIL, LIBRARIES_URI);
    expect(readFileSync(join(benchDir(), "graph.yaml"), "utf8")).toContain(
      "IN: [ fader ]",
    );
    expect(readFileSync(library("chains/vocals/warm/graph.yaml"), "utf8")).toBe(
      before,
    );
  });
});
