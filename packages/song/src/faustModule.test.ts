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

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";

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

/** Rewrite the fixture's instrument as a Faust module, with or without its source beside it. */
function asFaust(withSource: boolean): void {
  const folder = join(dir, "modules", "instruments", "synth");
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
  dir = mkdtempSync(join(tmpdir(), "td-faust-"));
  cpSync(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

  /** Copy a SHIPPED module in: `at` is its library path, `into` where it can sit in this project. */
  const ship = (at: string, into = at): void => {
    const to = join(dir, "modules", ...into.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(here, "..", "..", "dsp", "modules", ...at.split("/")), to, {
      recursive: true,
    });
  };

  it("ships wurlitzer, which fits where an instrument is played", () => {
    ship("instruments/synth/wurlitzer", "instruments/wurlitzer");
    writeFileSync(
      join(dir, "nodes", "lead.yaml"),
      "extends: instruments/wurlitzer\n",
      "utf8",
    );
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.type).toBe("Faust");
    expect(p?.faustDsp).toContain("process =");
  });

  it("ships moogladder, which fits after one", () => {
    // Between the instrument and the output: on `lead`'s slot the typed-input check refuses it.
    ship("audio/filter/moogladder");
    writeFileSync(
      join(dir, "nodes", "moog.yaml"),
      "extends: audio/filter/moogladder\n",
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
