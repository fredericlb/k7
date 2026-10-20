// Which projects wait for the engine's plugin scan: those naming a plugin only the scan can know.
// What would be wrong SILENTLY: a ref the stale scan cannot resolve read as "no external plugin".

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { namesExternalPlugin } from "./externalPlugins";
import { replaceChainStep, writeNode } from "./testSupport";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const SONG = join(REPO, "demos", "synth-demo.k7");

describe("namesExternalPlugin", () => {
  let ws: string;
  let dir: string;
  let home: string | undefined;
  beforeEach(() => {
    // No scan at all: the built-ins stand in, and no external is known.
    home = process.env.STUDIO_HOME;
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "td-ext-home-"));
    ws = mkdtempSync(join(tmpdir(), "td-ext-"));
    dir = join(ws, "synth-demo.k7");
    cpSync(SONG, dir, { recursive: true });
    cpSync(join(REPO, "demos", "_modules"), join(ws, "_modules"), {
      recursive: true,
    });
  });
  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    process.env.STUDIO_HOME = home;
  });

  it("lets a project of built-ins through", () => {
    writeNode(dir, "osc", { extends: "@engine/4osc" });
    replaceChainStep(dir, "lead", { module: "osc" });
    expect(namesExternalPlugin(dir)).toBe(false);
  });

  it("holds a node whose plugin is an external format", () => {
    writeNode(dir, "serum", { plugin: { type: "vst3", name: "Serum" } });
    replaceChainStep(dir, "lead", { module: "serum" });
    expect(namesExternalPlugin(dir)).toBe(true);
  });

  it("holds a node extending an engine ref the scan does not know yet", () => {
    writeNode(dir, "pad", { extends: "@engine/serum" });
    replaceChainStep(dir, "lead", { module: "pad" });
    expect(namesExternalPlugin(dir)).toBe(true);
  });

  it("holds a chain step naming that ref directly", () => {
    replaceChainStep(dir, "lead", { module: "@engine/serum" });
    expect(namesExternalPlugin(dir)).toBe(true);
  });

  it("answers false for a folder that is no project", () => {
    expect(namesExternalPlugin(join(ws, "nothing.k7"))).toBe(false);
  });
});
