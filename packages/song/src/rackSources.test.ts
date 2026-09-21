// Where a rack's audio lives: `sources/` inside the module folder, which is also the one part of a
// module the editor's tree still shows (docs/moduleAssets.md). Older racks kept their samples loose
// beside module.yaml, and those still load — the fallback is what makes the convention adoptable.
// A rack module needs its own folder for `sources/`, so these live at `@workspace`.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModuleRefs } from "./loader";
import { resolvedRack } from "./moduleResolve";
import { writeYaml } from "./testSupport";

let ws: string;
let dir: string;
const rack = (clip: string) => ({
  type: "rack",
  rack: { rack_type: "samples", symbols: { KICK: { note: 36, clip } } },
});
const clipOf = (name: string): string =>
  String(
    resolvedRack(
      loadModuleRefs(dir, {})[`@workspace/instruments/${name}`] as never,
    ).symbols.KICK.clip ?? "",
  );

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-rack-"));
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.yaml"), "project:\n  name: t\n", "utf8");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a samples rack's audio", () => {
  it("resolves a bare clip name against the module's sources/", () => {
    writeYaml(
      join(ws, "_modules", "instruments", "kit", "module.yaml"),
      rack("k.wav"),
    );
    const sources = join(ws, "_modules", "instruments", "kit", "sources");
    mkdirSync(sources, { recursive: true });
    writeFileSync(join(sources, "k.wav"), "RIFF", "utf8");
    expect(clipOf("kit")).toBe(join(sources, "k.wav"));
  });

  it("still finds a sample left loose beside module.yaml", () => {
    const folder = join(ws, "_modules", "instruments", "old");
    writeYaml(join(folder, "module.yaml"), rack("k.wav"));
    writeFileSync(join(folder, "k.wav"), "RIFF", "utf8");
    expect(clipOf("old")).toBe(join(folder, "k.wav"));
  });

  it("refuses a clip that climbs out of the module", () => {
    const folder = join(ws, "_modules", "instruments", "esc");
    writeYaml(join(folder, "module.yaml"), rack("../../../secret.wav"));
    writeFileSync(join(ws, "secret.wav"), "RIFF", "utf8");
    // Not resolved to the file outside: the fallback joins it, and nothing reads it as an asset.
    expect(clipOf("esc")).toBe(join(folder, "../../../secret.wav"));
  });
});
