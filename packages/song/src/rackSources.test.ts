// Where a rack's audio lives: `sources/` inside the module folder, which is also the one part of a
// module the editor's tree still shows (docs/moduleAssets.md). Older racks kept their samples loose
// beside module.yaml, and those still load — the fallback is what makes the convention adoptable.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules } from "./loader";
import { resolvedRack } from "./moduleResolve";
import { writeModule } from "./testSupport";

let dir: string;
const rack = (clip: string) => ({
  type: "rack",
  rack: { rack_type: "samples", symbols: { KICK: { note: 36, clip } } },
});
const clipOf = (name: string): string =>
  String(resolvedRack(loadModules(dir)[name] as never).symbols.KICK.clip ?? "");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-rack-"));
  writeFileSync(join(dir, "project.yaml"), "project:\n  name: t\n", "utf8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a samples rack's audio", () => {
  it("resolves a bare clip name against the module's sources/", () => {
    writeModule(dir, "instruments", "kit", rack("k.wav"));
    const sources = join(dir, "modules", "instruments", "kit", "sources");
    mkdirSync(sources, { recursive: true });
    writeFileSync(join(sources, "k.wav"), "RIFF", "utf8");
    expect(clipOf("kit")).toBe(join(sources, "k.wav"));
  });

  it("still finds a sample left loose beside module.yaml", () => {
    writeModule(dir, "instruments", "old", rack("k.wav"));
    const folder = join(dir, "modules", "instruments", "old");
    writeFileSync(join(folder, "k.wav"), "RIFF", "utf8");
    expect(clipOf("old")).toBe(join(folder, "k.wav"));
  });

  it("refuses a clip that climbs out of the module", () => {
    writeModule(dir, "instruments", "esc", rack("../../../secret.wav"));
    writeFileSync(join(dir, "secret.wav"), "RIFF", "utf8");
    // Not resolved to the file outside: the fallback joins it, and nothing reads it as an asset.
    expect(clipOf("esc")).toBe(
      join(dir, "modules", "instruments", "esc", "../../../secret.wav"),
    );
  });
});
