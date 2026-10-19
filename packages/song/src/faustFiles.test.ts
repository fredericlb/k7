// A Faust module's `soundfile` slots, filled by the node's STRING params: resolved to absolute paths in
// `faustFiles`, kept out of the knobs, and passed through unresolved so the engine can name what is missing.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faustFilesOf } from "./faustFiles";
import { compileNodeProject } from "./nodeProject";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");

let ws: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-faustfiles-"));
  dir = join(ws, "synth-demo.k7");
  cpSync(join(DEMOS, "synth-demo.k7"), dir, { recursive: true });
  cpSync(join(DEMOS, "_modules"), join(ws, "_modules"), {
    recursive: true,
  });
  const folder = join(ws, "_modules", "instruments", "synth");
  writeFileSync(
    join(folder, "module.k7x"),
    'plugin({ type: "faust", name: "Synth" })\n',
    "utf8",
  );
  writeFileSync(
    join(folder, "dsp.dsp"),
    'import("stdfaust.lib");\nfreq = hslider("freq", 440, 20, 20000, 0.01);\ngate = button("gate");\nt = soundfile("Table", 1);\nprocess = (0, int(os.phasor(2048, freq))) : t : !, !, _ : *(en.adsr(0.01, 0.1, 0.8, 0.2, gate));\n',
    "utf8",
  );
  mkdirSync(join(dir, "wavetables"), { recursive: true });
  writeFileSync(join(dir, "wavetables", "saw.wav"), "RIFF", "utf8");
  writeFileSync(
    join(dir, "nodes", "lead.k7x"),
    'extends("@workspace/instruments/synth")\nparams({ Table: "wavetables/saw.wav" })\n',
    "utf8",
  );
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a faust module's sound files", () => {
  it("travel as an absolute path by slot label, and never as a knob", () => {
    const p = compileNodeProject(dir)
      .tracks.flatMap((t) => t.plugins ?? [])
      .find((x) => x.id.endsWith(":lead"));
    expect(p?.faustFiles).toEqual({
      Table: join(dir, "wavetables", "saw.wav"),
    });
    expect(p?.params?.Table).toBeUndefined();
  });

  it("pass a ref that resolves nowhere through, for the engine's warning to name", () => {
    expect(faustFilesOf({ Table: "@nope/x.wav", Gain: 3 }, dir)).toEqual({
      Table: "@nope/x.wav",
    });
    expect(faustFilesOf({ Gain: 3 }, dir)).toBeUndefined();
  });
});
