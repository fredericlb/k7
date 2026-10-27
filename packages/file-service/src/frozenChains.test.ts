// Frozen chains against a library on disk, edited the way a person does: on the bench. What would go
// wrong unseen: a save losing a node's engine values or its step id, a bench with a branch or nothing
// in it written as a chain, and a saved chain the recorder's live list does not find.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootDir } from "@studio/engine-client/paths";
import { writeDoc } from "@studio/song/testSupport";
import { wsData, wsWriteData } from "@studio/song/yaml/workspaceDoc";
import { BENCH_PROJECT, benchProject } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { liveChains } from "./benchChain.ts";
import {
  copyFrozenChain,
  deleteFrozenChain,
  listFrozenChains,
  saveBenchChain,
} from "./frozenChains.ts";

const EMAIL = "someone@example.test";
const PINNED_HOME = process.env.STUDIO_HOME;
let home: string;

const benchDir = (): string => join(rootDir(), BENCH_WORKSPACE, BENCH_PROJECT);
const put = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(home, "libraries", "k7-core", rel), value);
const accountFile = (name: string): string =>
  readFileSync(join(home, "library/chains", `${name}.k7x`), "utf8");
const graphOf = (): string =>
  readFileSync(join(benchDir(), "graph.k7x"), "utf8");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-frozen-chains-"));
  process.env.STUDIO_HOME = home;
  put("modules/audio/comp/module.k7x", {
    plugin: { type: "internal", name: "Compressor" },
  });
  put("modules/audio/delay/module.k7x", { engine: "tape" });
  put("modules/audio/delay/engines/tape/module.k7x", {
    plugin: { type: "internal", name: "Delay tape" },
  });
  put("modules/cold/split/module.k7x", {
    cold: true,
    plugin: { type: "offline", name: "split" },
  });
  put("chains/stems.k7x", {
    steps: [
      { id: "s1", extends: "@k7-core/cold/split" },
      { to: [{ chain: "@out" }] },
    ],
  });
  put("chains/vocals.k7x", {
    steps: [
      { id: "v1", extends: "@k7-core/audio/comp", params: { Ratio: 0.5 } },
      {
        id: "v2",
        extends: "@k7-core/audio/delay",
        engine: "tape",
        engines: { tape: { params: { Wow: 0.2 } } },
      },
      { to: [{ chain: "@out" }] },
    ],
  });
});

afterEach(() => {
  process.env.STUDIO_HOME = PINNED_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("frozen chains", () => {
  it("lists the libraries' cold chains read-only, and no other library chain", () => {
    expect(listFrozenChains(benchDir())).toMatchObject([
      { ref: "@k7-core/stems", mine: false, cold: true },
    ]);
  });

  it("saves the bench's run as the account's chain, each node whole and its step id kept", async () => {
    await ensureBench(EMAIL, benchProject("@k7-core/vocals"));
    // A knob turned on the bench lands in the node file, under the engine it plays as.
    const delay = join(benchDir(), "nodes", "delay.k7x");
    wsWriteData(delay, {
      ...wsData(delay),
      engines: { tape: { params: { Wow: 0.9 } } },
    });
    expect(saveBenchChain("warm-vox")).toMatchObject({
      ref: "@account/warm-vox",
      mine: true,
      liveRefusal: null,
      steps: [
        { id: "v1", module: "@k7-core/audio/comp", params: { Ratio: 0.5 } },
        {
          id: "v2",
          module: "@k7-core/audio/delay",
          engine: "tape",
          params: { Wow: 0.9 },
        },
      ],
    });
    expect(accountFile("warm-vox")).toContain('engine("tape")');
    expect(liveChains(benchDir())).toContainEqual({
      ref: "@account/warm-vox",
      unavailable: null,
    });
    // Opened again on the saved chain, the bench names it, so a bare `chain save` writes it back.
    await ensureBench(EMAIL, benchProject("@account/warm-vox"));
    expect(saveBenchChain().ref).toBe("@account/warm-vox");
  });

  it("saves a node that names its plugin itself, as `node new` writes an engine-provided module", async () => {
    await ensureBench(EMAIL, BENCH_PROJECT);
    wsWriteData(join(benchDir(), "nodes", "comp.k7x"), {
      plugin: { type: "internal", name: "Compressor" },
    });
    writeFileSync(
      join(benchDir(), "graph.k7x"),
      graphOf().replace(/IN: \["fader"\]/, 'IN: ["comp"], comp: ["fader"]'),
    );
    expect(saveBenchChain("built-in").steps).toMatchObject([
      { module: "Compressor" },
    ]);
    expect(accountFile("built-in")).toContain('name: "Compressor"');
  });

  it("keeps IN's input channel, alone, and feeds IN from it when the bench opens on the chain again", async () => {
    await ensureBench(EMAIL, BENCH_PROJECT);
    // What the node card's channel select writes: `node param IN @channel 1,2`.
    const inFile = join(benchDir(), "nodes", "IN.k7x");
    wsWriteData(inFile, { ...wsData(inFile), channel: [1, 2] });
    expect(saveBenchChain("mic")).toMatchObject({
      ref: "@account/mic",
      steps: [],
      input: { channel: [1, 2] },
      liveRefusal: null,
    });
    expect(accountFile("mic")).toContain("input(");
    await ensureBench(EMAIL, benchProject("@account/mic"));
    expect(wsData(inFile).channel).toEqual([1, 2]);
    expect(graphOf()).toMatch(/IN: \["fader"\]/);
  });

  it("refuses an empty bench, a branch, and a nameless save of a chain that is not the account's", async () => {
    await ensureBench(EMAIL, BENCH_PROJECT);
    expect(() => saveBenchChain("empty")).toThrow(/nothing to keep yet/);
    // A module wired after the fader is named, so the refusal says what to move.
    wsWriteData(join(benchDir(), "nodes", "eq.k7x"), {
      extends: "@k7-core/audio/comp",
    });
    expect(() => saveBenchChain("empty")).toThrow(
      /eq is on the bench but not wired between them/,
    );
    rmSync(join(benchDir(), "nodes", "eq.k7x"));
    await ensureBench(EMAIL, benchProject("@k7-core/vocals"));
    expect(() => saveBenchChain()).toThrow(/name the chain/);
    writeFileSync(
      join(benchDir(), "graph.k7x"),
      graphOf().replace(/IN: \["comp"\]/, 'IN: ["comp", "delay"]'),
    );
    expect(() => saveBenchChain("forked")).toThrow(/one run/);
    expect(listFrozenChains(benchDir()).some((c) => c.mine)).toBe(false);
  });

  it("copies a library chain whole with fresh ids, refuses a name already taken, and deletes", () => {
    const copy = copyFrozenChain(benchDir(), "@k7-core/vocals", "mine");
    expect(copy.steps.map((s) => s.module)).toEqual([
      "@k7-core/audio/comp",
      "@k7-core/audio/delay",
    ]);
    expect(copy.steps.map((s) => s.id)).not.toContain("v1");
    expect(copy.steps[1]).toMatchObject({
      engine: "tape",
      params: { Wow: 0.2 },
    });
    expect(() => copyFrozenChain(benchDir(), "@k7-core/stems", "mine")).toThrow(
      /already have/,
    );
    deleteFrozenChain("mine");
    expect(listFrozenChains(benchDir()).some((c) => c.mine)).toBe(false);
  });
});
