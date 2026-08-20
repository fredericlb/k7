// How the Chains tab draws an `offline` module — m9's tempo is one.
//
// The mirror image of jsdspGraph.test.ts, and the trap is that they look alike. Both formats
// are `known`, so neither node goes red. But `jsdsp` becomes a real plugin in the compiled
// document and `offline` becomes NOTHING: the compiler reads the type and skips the emit.
//
// So a pluginId here names an address no document contains, and everything downstream
// believes it. m9's tempo faders were classed as plugin params and sent `set-plugin-param`
// to `deckA:tempoA` for ever; the panel drew a knob that moved and changed nothing.

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
  "synth-demo.st0",
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fs-offline-"));
  cpSync(SONG, dir, { recursive: true });
  const folder = join(dir, "modules", "instruments", "synth");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "cold: true\nplugin:\n  type: offline\n  name: Tempo\nparams:\n  Target BPM: 0\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lead = () =>
  buildGraphDoc(dir).chains.melody?.use.find((s) => s.module === "lead");

describe("an offline module in the graph", () => {
  it("carries NO pluginId, because the document will carry no plugin", () => {
    // The whole point. `offline` means realised outside the graph — a pass that writes files,
    // or the player warping the clip it feeds — and the address of that is the track, not a
    // plugin the engine was never given.
    expect(lead()?.pluginId).toBeUndefined();
  });

  it("is still not flagged as a plugin the engine cannot load", () => {
    // The colour and the address are separate facts, and this is the one jsdsp got wrong in
    // the other direction: drawing it red would call a module that works exactly as written
    // broken. It loads nothing BY DESIGN.
    expect(lead()?.unknownPlugin).toBeUndefined();
    expect(lead()?.notSupported).toBeUndefined();
  });

  it("still carries its declared params, which are all it can show", () => {
    // Nothing live will ever arrive for them: `liveParams` is keyed by plugin id and there is
    // no plugin. What the panel draws is what the file says.
    expect(lead()?.params).toMatchObject({ "Target BPM": 0 });
  });
});
