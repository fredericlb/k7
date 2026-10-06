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
import { BENCH_PROJECT, benchProject } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { liveChains } from "./benchChain.ts";

const EMAIL = "someone@example.test";
const PINNED_HOME = process.env.STUDIO_HOME;
let home: string;

const benchRoot = (): string => join(rootDir(), BENCH_WORKSPACE);
const benchDir = (): string => join(benchRoot(), BENCH_PROJECT);
/** The account's `st0` library, where the file service clones it — under `$STUDIO_HOME`. */
const library = (rel: string): string => join(home, "libraries", "st0", rel);

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
  // The same chain as a FILE: nodes inline, named by id, and a preset in the library's vstpresets/.
  put(
    "chains/vocals/bright.yaml",
    'steps:\n  - { id: a1, extends: "@st0/audio/comp", params: { Ratio: 0.5 } }\n' +
      '  - { id: b2, extends: "@st0/audio/eq", bypass: true }\n  - to: [ { chain: "@out" } ]\n',
  );
  put("vstpresets/a1.vstpreset", "state");
});

afterEach(() => {
  process.env.STUDIO_HOME = PINNED_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("the bench, on a library chain", () => {
  it("lists every chain, refusing a cold one by name", () => {
    const chains = liveChains(benchDir());
    expect(chains.map((c) => c.ref)).toEqual([
      "@st0/master/norm",
      "@st0/vocals/bright",
      "@st0/vocals/warm",
    ]);
    expect(chains[0].unavailable).toContain("on disk");
    expect(chains[1].unavailable).toBeNull();
    expect(chains[2].unavailable).toBeNull();
  });

  it("puts the chain between the input and the fader, the rest of the rig untouched", async () => {
    await ensureBench(EMAIL, benchProject("vocals/warm"));
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

  it("copies a chain FILE as the bench's own segments and node files, named after their modules", async () => {
    await ensureBench(EMAIL, benchProject("vocals/bright"));
    const graph = readFileSync(join(benchDir(), "graph.yaml"), "utf8");
    expect(graph).toContain("IN: [ comp ]");
    expect(graph).toContain("comp: [ eq ]");
    expect(graph).toContain("eq: [ fader ]");
    expect(graph).toMatch(/bypassed: \[ eq \]/);
    expect(
      readFileSync(join(benchDir(), "nodes", "comp.yaml"), "utf8"),
    ).toContain("Ratio: 0.5");
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
      library("chains/vocals/warm/graph.yaml"),
      "utf8",
    );
    await ensureBench(EMAIL, benchProject("vocals/warm"));
    await ensureBench(EMAIL, benchProject("vocals/warm"));
    expect(readFileSync(library("chains/vocals/warm/graph.yaml"), "utf8")).toBe(
      before,
    );
  });
});
