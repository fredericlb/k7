// How the Chains tab draws an `offline` module — a deck's tempo is one.
//
// The mirror image of jsdspGraph.test.ts, and the trap is that they look alike. Both formats
// are `known`, so neither node goes red. But `jsdsp` becomes a real plugin in the compiled
// document and `offline` becomes NOTHING: the compiler reads the type and skips the emit.
//
// So a pluginId here names an address no document contains, and everything downstream believes
// it: a tempo fader sends `set-plugin-param` to `deckA:tempoA` for ever, and the panel draws a
// knob that moves and changes nothing.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");

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
    // `offline` means realised outside the graph, and the address of that is the TRACK.
    expect(lead()?.pluginId).toBeUndefined();
  });

  it("is still not flagged as a plugin the engine cannot load", () => {
    // The colour and the address are separate facts: this module loads nothing BY DESIGN.
    expect(lead()?.unknownPlugin).toBeUndefined();
    expect(lead()?.notSupported).toBeUndefined();
  });

  it("still carries its declared params, which are all it can show", () => {
    // `liveParams` is keyed by plugin id and there is none, so the panel draws what the file says.
    expect(lead()?.params).toMatchObject({ "Target BPM": 0 });
  });
});
