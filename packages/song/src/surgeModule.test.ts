// A Surge XT module — `extends("@engine/surge-xt")` and a `base` patch — on a machine whose engine
// has not been scanned: the built-in must still reach the engine, with its patch (docs/enginePlugin.md).

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");

let ws: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-surge-"));
  dir = join(ws, "synth-demo.k7");
  cpSync(join(DEMOS, "synth-demo.k7"), dir, { recursive: true });
  cpSync(join(DEMOS, "_modules"), join(ws, "_modules"), { recursive: true });
  // The fixture's instrument rewritten as the library's Surge module, its default patch beside it.
  const folder = join(ws, "_modules", "instruments", "synth");
  writeFileSync(
    join(folder, "module.k7x"),
    'extends("@engine/surge-xt")\nbase("Pads/Bell Pad")\n',
    "utf8",
  );
  mkdirSync(join(folder, "base", "Pads"), { recursive: true });
  writeFileSync(join(folder, "base", "Pads", "Bell Pad.fxp"), "x", "utf8");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

it("sends the patch with no scan to resolve @engine/surge-xt against", () => {
  // $STUDIO_HOME is pinned at a folder that does not exist (vitest.config), so there is no exts.json.
  const plugins = compileNodeProject(dir).tracks.flatMap((t) => t.plugins);
  const surge = plugins.filter((p) => p.surgePatch);
  // The demo plays its synth on two nodes, and each one carries the patch.
  expect(surge).toHaveLength(2);
  for (const p of surge)
    expect(p.surgePatch).toMatch(/Pads[\\/]Bell Pad\.fxp$/);
});
