// A module whose DSP is the `dsp.dsp` beside it — `plugin: {type: faust}`, the sibling of the
// jsdsp form next door.
//
// Same four assertions as jsdspModule.test.ts, and deliberately so: this is the shape a new
// plugin type has to satisfy, and every one of them pins a gate that answers SILENTLY when it
// does not know a word. A module dropped for an unknown type is indistinguishable from a
// bypassed one, which is what made the jsdsp version of this bug expensive.
//
// The one difference is the last: there is no build step here, so what travels is the source
// itself. See packages/song/docs/faustModules.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { copyAsYaml } from "./testSupport";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");
const SONG = join(DEMOS, "synth-demo.st0");

let ws: string;
let dir: string;

/** Rewrite the fixture's instrument as a Faust module, with or without its source beside it. */
function asFaust(withSource: boolean): void {
  const folder = join(ws, "_modules", "instruments", "synth");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "plugin:\n  type: faust\n  name: Synth\n",
    "utf8",
  );
  if (withSource)
    writeFileSync(
      join(folder, "dsp.dsp"),
      'import("stdfaust.lib");\ncutoff = hslider("Cutoff", 800, 20, 20000, 1);\nprocess = par(i, 2, fi.lowpass(2, cutoff));\n',
      "utf8",
    );
}

const plugins = () =>
  compileNodeProject(dir).tracks.flatMap((t) => t.plugins ?? []);

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-faust-"));
  dir = join(ws, "synth-demo.st0");
  copyAsYaml(SONG, dir, { recursive: true });
  // The Examples workspace's own shared library, beside every demo project.
  copyAsYaml(join(DEMOS, "_modules"), join(ws, "_modules"), {
    recursive: true,
  });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a faust module", () => {
  it("reaches the engine at all", () => {
    // The compiler's format gate has to know the word, or the module is dropped without a line.
    asFaust(true);
    expect(plugins().some((p) => p.id.endsWith(":lead"))).toBe(true);
  });

  it("arrives as the engine's Faust host, not as the word the author wrote", () => {
    asFaust(true);
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.type).toBe("Faust");
    expect(p?.name).toBe("lead"); // the module names it — a built-in has no scan entry
  });

  it("carries its SOURCE inline, not a compiled artifact", () => {
    // The compiler is on the engine's side, so the TEXT travels and there is no build step here.
    asFaust(true);
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.faustDsp).toContain('hslider("Cutoff"');
    expect(p?.dspGraph).toBeUndefined(); // never both — one module, one plugin, one property
  });

  /**
   * A Faust module written into this project. FIXTURES rather than a copy of a real module: those
   * live in an account's library and nowhere in this tree (packages/dsp/docs/catalogue.md), and
   * whether a real one COMPILES is the Faust binary's question, not this one's.
   */
  const faustModule = (at: string, source: string): void => {
    const folder = join(ws, "_modules", ...at.split("/"));
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "module.yaml"),
      "plugin:\n  type: faust\n  name: Fixture\n",
      "utf8",
    );
    writeFileSync(join(folder, "dsp.dsp"), source, "utf8");
  };

  it("fits where an INSTRUMENT is played — no audio in, two out", () => {
    faustModule(
      "instruments/wurlitzer",
      'import("stdfaust.lib");\nprocess = par(i, 2, os.osc(440) * 0.1);\n',
    );
    writeFileSync(
      join(dir, "nodes", "lead.yaml"),
      'extends: "@workspace/instruments/wurlitzer"\n',
      "utf8",
    );
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.type).toBe("Faust");
    expect(p?.faustDsp).toContain("process =");
  });

  it("fits AFTER one, on a slot of its own", () => {
    // Between the instrument and the output: on `lead`'s slot the typed-input check refuses it.
    faustModule(
      "audio/filter/moogladder",
      'import("stdfaust.lib");\nprocess = par(i, 2, ve.moog_vcf(0.7, 2000));\n',
    );
    writeFileSync(
      join(dir, "nodes", "moog.yaml"),
      'extends: "@workspace/audio/filter/moogladder"\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  melody: [ lead ]\n  pad#midi: [ synth-pad ]\n  lead: [ moog ]\n  moog: [ OUT ]\n  synth-pad: [ OUT ]\n",
      "utf8",
    );
    const p = plugins().find((x) => x.id.endsWith(":moog"));
    expect(p?.type).toBe("Faust");
    expect(p?.faustDsp).toContain("ve.moog_vcf");
  });

  it("still compiles when the source is missing", () => {
    // A missing file costs the SOUND, never the node, or a module comes and goes from the song.
    asFaust(false);
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.type).toBe("Faust");
    expect(p?.faustDsp).toBeUndefined();
  });
});
