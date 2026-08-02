import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModules } from "@lanes/song/loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPresetToModule,
  listModulePresets,
  modulePresetsDir,
  saveModuleAsPreset,
} from "./presets";
import { setModuleParam } from "./projectEdit";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "apps",
  "capot",
  "songs",
  "synth-demo",
);
const REF = "instruments/synth"; // the synth module's own ref

// modulePresetsDir is pure string work — no `cue`, no fs — so it always runs.
describe("modulePresetsDir", () => {
  it("maps a local plugin ref to its `.presets` folder beside the module", () => {
    expect(modulePresetsDir("/song", REF)).toBe(
      join("/song", "modules", "instruments", "synth", "synth.presets"),
    );
  });
  it("declines io, inherited, and malformed refs (nowhere local to store them)", () => {
    expect(modulePresetsDir("/song", "OUT")).toBeNull(); // io sink, bare name
    expect(modulePresetsDir("/song", "@lib/instruments/x")).toBeNull(); // inherited
    expect(modulePresetsDir("/song", "io/whatever")).toBeNull(); // io kind
  });
});

describe("user presets round-trip (synth-demo)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-presets-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("saves a module's params as a preset, lists it, and applies it back", () => {
    // Give the module a param to snapshot (the demo's synth rides its base's defaults).
    setModuleParam(dir, "synth", "Filter Freq", 0.42);

    const rel = saveModuleAsPreset(dir, "synth", "warm");
    expect(rel).toBe(
      join("modules", "instruments", "synth", "synth.presets", "warm.yaml"),
    );
    expect(existsSync(join(dir, rel))).toBe(true);

    const presets = listModulePresets(dir, REF);
    expect(presets.map((p) => ({ name: p.name, source: p.source }))).toEqual([
      { name: "warm", source: "user" },
    ]);

    // Move the live value away, then apply the preset and confirm it's restored.
    setModuleParam(dir, "synth", "Filter Freq", 0.9);
    applyPresetToModule(dir, "synth", presets[0].path);
    const mod = loadModules(dir) as Record<
      string,
      { params?: Record<string, number> }
    >;
    expect(mod.synth.params?.["Filter Freq"]).toBeCloseTo(0.42, 6);
  });

  it("refuses to overwrite an existing preset and validates the name", () => {
    setModuleParam(dir, "synth", "Filter Freq", 0.42);
    saveModuleAsPreset(dir, "synth", "warm");
    expect(() => saveModuleAsPreset(dir, "synth", "warm")).toThrow(
      /already exists/,
    );
    expect(() => saveModuleAsPreset(dir, "synth", "bad/name")).toThrow(
      /invalid preset name/,
    );
  });

  it("won't snapshot a module with nothing saved", () => {
    // The demo's synth has neither params nor a .vstpreset until something is set.
    expect(() => saveModuleAsPreset(dir, "synth", "empty")).toThrow(
      /no saved params/,
    );
  });

  it("ignores non-preset files in the folder and reads a hand-authored preset", () => {
    setModuleParam(dir, "synth", "Filter Freq", 0.42);
    saveModuleAsPreset(dir, "synth", "warm");
    // A hand-dropped preset (as if authored by the user) is discovered too.
    const dropped = join(modulePresetsDir(dir, REF)!, "bright.yaml");
    writeFileSync(dropped, 'params: {"Filter Freq": 0.8}\n', "utf8");
    const names = listModulePresets(dir, REF)
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(["bright", "warm"]);

    applyPresetToModule(dir, "synth", dropped);
    const mod = loadModules(dir) as Record<
      string,
      { params?: Record<string, number> }
    >;
    expect(mod.synth.params?.["Filter Freq"]).toBeCloseTo(0.8, 6);
  });
});
