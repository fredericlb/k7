// The home page's Frozen chains, against a library on disk. What would go wrong unseen: a saved engine
// value landing in the top-level `params` an engine ignores, a chain that separates AND treats written
// anyway, and a saved chain the recorder's live list or a library reader does not find.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootDir } from "@studio/engine-client/paths";
import { writeDoc } from "@studio/song/testSupport";
import { BENCH_PROJECT } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE } from "./bench.ts";
import { liveChains } from "./benchChain.ts";
import {
  chainModuleParams,
  chainModules,
  deleteFrozenChain,
  listFrozenChains,
  saveFrozenChain,
} from "./frozenChains.ts";

const PINNED_HOME = process.env.STUDIO_HOME;
let home: string;

const benchDir = (): string => join(rootDir(), BENCH_WORKSPACE, BENCH_PROJECT);
const put = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(home, "libraries", "k7-core", rel), value);
const knob = (bind: string, max = 1) => ({
  type: "knob",
  col: 0,
  row: 0,
  label: bind,
  bind,
  min: 0,
  max,
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-frozen-chains-"));
  process.env.STUDIO_HOME = home;
  put("modules/audio/comp/module.k7x", {
    plugin: { type: "internal", name: "Compressor" },
    params: { Ratio: 0.3 },
    ui: { cols: 2, rows: 2, widgets: { ratio: knob("Ratio") } },
  });
  put("modules/audio/delay/module.k7x", { engine: "tape" });
  for (const [e, p] of [
    ["tape", "Wow"],
    ["digital", "Time"],
  ] as const)
    put(`modules/audio/delay/engines/${e}/module.k7x`, {
      plugin: { type: "internal", name: `Delay ${e}` },
      ui: { cols: 2, rows: 2, widgets: { k: knob(p, 2) } },
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
      { id: "v1", extends: "@k7-core/audio/comp" },
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
      {
        ref: "@k7-core/stems",
        mine: false,
        cold: true,
        steps: [{ module: "@k7-core/cold/split" }],
      },
    ]);
  });

  it("offers the modules a step may extend, with their engines and knobs", () => {
    const mods = chainModules(benchDir());
    expect(mods.find((m) => m.ref === "@k7-core/audio/delay")).toMatchObject({
      engines: ["digital", "tape"],
      engine: "tape",
      offline: false,
    });
    expect(mods.find((m) => m.ref === "@k7-core/cold/split")?.offline).toBe(
      true,
    );
    expect(chainModuleParams(benchDir(), "@k7-core/audio/comp")).toEqual({
      params: [{ name: "Ratio", label: "Ratio", min: 0, max: 1, value: 0.3 }],
    });
    expect(
      chainModuleParams(benchDir(), "@k7-core/audio/delay", "digital"),
    ).toMatchObject({ engine: "digital", params: [{ name: "Time", max: 2 }] });
  });

  it("saves a chain into the account's library, its engine's values under that engine", () => {
    const saved = saveFrozenChain(benchDir(), "warm-vox", [
      { module: "@k7-core/audio/comp", params: { Ratio: 0.7 } },
      {
        module: "@k7-core/audio/delay",
        engine: "digital",
        params: { Time: 0.25 },
      },
    ]);
    expect(saved).toMatchObject({
      ref: "@account/warm-vox",
      mine: true,
      cold: false,
      liveRefusal: null,
    });
    const text = readFileSync(
      join(home, "library/chains/warm-vox.k7x"),
      "utf8",
    );
    expect(text).toContain("engines");
    const [mine] = listFrozenChains(benchDir());
    expect(mine?.steps).toMatchObject([
      { module: "@k7-core/audio/comp", params: { Ratio: 0.7 } },
      {
        module: "@k7-core/audio/delay",
        engine: "digital",
        params: { Time: 0.25 },
      },
    ]);
    // The recorder's live list reads the same libraries, so it finds the chain unaided.
    expect(liveChains(benchDir())).toContainEqual({
      ref: "@account/warm-vox",
      unavailable: null,
    });
    deleteFrozenChain("warm-vox");
    expect(listFrozenChains(benchDir()).some((c) => c.mine)).toBe(false);
  });

  it("writes a step naming no engine under the module's default one, where the engine reads it", () => {
    saveFrozenChain(benchDir(), "tape-only", [
      { module: "@k7-core/audio/delay", params: { Wow: 1.5 } },
    ]);
    const [mine] = listFrozenChains(benchDir());
    expect(mine?.steps).toMatchObject([
      { module: "@k7-core/audio/delay", engine: "tape", params: { Wow: 1.5 } },
    ]);
    const text = readFileSync(
      join(home, "library/chains/tape-only.k7x"),
      "utf8",
    );
    expect(text).toContain("engines");
  });

  it("refuses a chain that separates and treats, an unknown module, and a bad name", () => {
    expect(() =>
      saveFrozenChain(benchDir(), "both", [
        { module: "@k7-core/cold/split", params: {} },
        { module: "@k7-core/audio/comp", params: {} },
      ]),
    ).toThrow(/separates or it treats/);
    expect(() =>
      saveFrozenChain(benchDir(), "ghost", [
        { module: "@k7-core/audio/nope", params: {} },
      ]),
    ).toThrow(/no module/);
    expect(() =>
      saveFrozenChain(benchDir(), "../out", [
        { module: "@k7-core/audio/comp", params: {} },
      ]),
    ).toThrow(/not a chain name/);
    expect(listFrozenChains(benchDir()).some((c) => c.mine)).toBe(false);
  });
});
