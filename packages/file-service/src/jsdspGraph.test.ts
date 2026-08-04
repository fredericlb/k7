// How the Chains tab draws a module whose DSP is the `jsdsp.ts` beside it — the form the
// médiathèque's own modules use.
//
// `known` here listed `internal` and the external formats, so `jsdsp` read as a plugin the
// engine cannot load. The node went RED, and — the part that is easy to miss — it lost its
// `pluginId`, which is the address the panel asks the engine for a parameter value by. A
// module you could plainly hear drew as one that had failed to load, with empty knobs.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo",
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fs-jsdsp-"));
  cpSync(SONG, dir, { recursive: true });
  const folder = join(dir, "modules", "instruments", "synth");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "plugin:\n  type: jsdsp\n  name: Synth\n",
    "utf8",
  );
  writeFileSync(join(folder, "jsdsp.ts"), "// dsp\n", "utf8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lead = () =>
  buildGraphDoc(dir).chains.melody?.use.find((s) => s.module === "synth:lead");

describe("a jsdsp module in the graph", () => {
  it("is not flagged as a plugin the engine cannot load", () => {
    expect(lead()?.unknownPlugin).toBeUndefined();
    expect(lead()?.notSupported).toBeUndefined();
    expect(lead()?.stub).toBe(false);
  });

  it("carries the pluginId its panel reads values by", () => {
    // Without this the widgets draw their labels and no values, which is what the red node
    // looked like from the outside: a module that plays, with an empty face.
    expect(lead()?.pluginId).toBe("melody:synth:lead");
  });

  it("offers no NATIVE editor, since the graph host has no window", () => {
    // The other half of the same fact: `ui` is the widget grid, `hasNativePluginUI` is the
    // plugin's own window — and a built-in has none to open.
    expect(lead()?.hasNativePluginUI).toBe(false);
  });
});
