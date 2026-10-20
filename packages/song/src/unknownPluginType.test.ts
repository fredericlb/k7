import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unknownPluginModules } from "./diagnostics";
import { compileNodeProject } from "./nodeProject";
import { replaceChainStep, writeNode } from "./testSupport";

// A plugin type the engine does not load compiles to nothing, so it must be SAID rather than played as silence.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const REPO = join(here, "..", "..", "..");
const SONG = join(REPO, "demos", "synth-demo.k7");

describe("a module's plugin type", () => {
  let ws: string;
  let dir: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-plugtype-"));
    dir = join(ws, "synth-demo.k7");
    cpSync(SONG, dir, { recursive: true });
    cpSync(join(REPO, "demos", "_modules"), join(ws, "_modules"), {
      recursive: true,
    });
    // The library's own Sampler module, as k7-core ships it.
    cpSync(
      join(REPO, "k7-core", "modules", "instruments", "sampler"),
      join(ws, "_modules", "instruments", "sampler"),
      { recursive: true },
    );
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("compiles the library's Sampler to the engine's built-in", () => {
    writeNode(dir, "smp", { extends: "@workspace/instruments/sampler" });
    replaceChainStep(dir, "lead", { module: "smp" });
    const doc = compileNodeProject(dir);
    const plugins = doc.tracks.flatMap((t) => t.plugins);
    const smp = plugins.find((p) => p.id.endsWith(":smp"));
    expect(smp?.type.toLowerCase()).toBe("sampler");
    expect(unknownPluginModules(dir)).toEqual([]);
  });

  it("reports a type no engine loads as an error on the node's file", () => {
    writeNode(dir, "bogus", { plugin: { type: "builtin", name: "Sampler" } });
    replaceChainStep(dir, "lead", { module: "bogus" });
    const doc = compileNodeProject(dir); // still compiles: a typo must not take the song down
    expect(
      doc.tracks.flatMap((t) => t.plugins).some((p) => p.id.endsWith(":bogus")),
    ).toBe(false);
    const [d, ...rest] = unknownPluginModules(dir);
    expect(rest).toEqual([]);
    expect(d?.file).toBe("nodes/bogus.k7x");
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain('"builtin"');
  });

  it("leaves every known type and the not_supported marker alone", () => {
    writeNode(dir, "skip", { plugin: { type: "not_supported", name: "X" } });
    replaceChainStep(dir, "lead", { module: "skip" });
    expect(unknownPluginModules(dir)).toEqual([]);
  });
});
