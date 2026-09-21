import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModuleRefs } from "@studio/song/loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPresetToModule,
  hasPresets,
  listModulePresets,
  modulePresetsFile,
  saveModuleAsPreset,
} from "./presets";
import { setModuleParam } from "./projectEdit";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");
const DEMO_MODULES = join(here, "..", "..", "..", "demos", "_modules");
const REF = "@workspace/instruments/synth"; // the synth module's own ref

// A preset is a NAME and the values it sets; the whole shelf is one file in the module's folder.

describe("presets round-trip (synth-demo)", () => {
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "td-presets-"));
    dir = join(root, "synth-demo.st0");
    cpSync(SONG, dir, { recursive: true });
    cpSync(DEMO_MODULES, join(root, "_modules"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const shelf = () =>
    readFileSync(modulePresetsFile(dir, REF) as string, "utf8");

  it("maps a workspace plugin ref to the presets.yaml in its module folder", () => {
    expect(modulePresetsFile(dir, REF)).toBe(
      join(root, "_modules", "instruments", "synth", "presets.yaml"),
    );
  });

  it("declines io, another level, and a bare ref (nowhere here to resolve them)", () => {
    expect(modulePresetsFile(dir, "OUT")).toBeNull(); // io sink, bare name
    expect(modulePresetsFile(dir, "@st0/instruments/x")).toBeNull(); // a different level, not mounted here
    expect(modulePresetsFile(dir, "instruments/synth")).toBeNull(); // bare, unnamespaced
  });

  it("saves a module's params as a preset, lists it, and applies it back", () => {
    // Give the module a param to snapshot (the demo's synth rides its base's defaults).
    setModuleParam(dir, REF, "Filter Freq", 0.42);
    expect(hasPresets(dir, REF)).toBe(false);

    const rel = saveModuleAsPreset(dir, REF, "warm");
    expect(rel).toBe(
      join("..", "_modules", "instruments", "synth", "presets.yaml"),
    );
    expect(hasPresets(dir, REF)).toBe(true);

    const presets = listModulePresets(dir, REF);
    expect(presets.map((p) => ({ name: p.name, source: p.source }))).toEqual([
      { name: "warm", source: "user" },
    ]);

    // Move the live value away, then apply the preset and confirm it's restored.
    setModuleParam(dir, REF, "Filter Freq", 0.9);
    applyPresetToModule(dir, REF, presets[0].name);
    const refs = loadModuleRefs(dir) as Record<
      string,
      { params?: Record<string, number> }
    >;
    expect(refs[REF].params?.["Filter Freq"]).toBeCloseTo(0.42, 6);
  });

  it("writes one preset per LINE, so adding a second is a one-line diff", () => {
    setModuleParam(dir, REF, "Filter Freq", 0.42);
    saveModuleAsPreset(dir, REF, "warm");
    setModuleParam(dir, REF, "Filter Freq", 0.9);
    saveModuleAsPreset(dir, REF, "bright");
    const lines = shelf().trim().split("\n");
    expect(lines[0]).toMatch(/^# presets for @workspace\/instruments\/synth$/);
    // A param name with a space needs no quotes as a YAML key, and plugins name nearly all of theirs so.
    expect(lines[1]).toBe("warm: { Filter Freq: 0.42 }");
    expect(lines[2]).toBe("bright: { Filter Freq: 0.9 }");
  });

  it("keeps the presets that were already there when it adds one", () => {
    setModuleParam(dir, REF, "Filter Freq", 0.42);
    saveModuleAsPreset(dir, REF, "warm");
    setModuleParam(dir, REF, "Filter Freq", 0.9);
    saveModuleAsPreset(dir, REF, "bright");
    expect(
      listModulePresets(dir, REF)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["bright", "warm"]);
  });

  it("refuses to overwrite an existing preset and validates the name", () => {
    setModuleParam(dir, REF, "Filter Freq", 0.42);
    saveModuleAsPreset(dir, REF, "warm");
    expect(() => saveModuleAsPreset(dir, REF, "warm")).toThrow(
      /already exists/,
    );
    expect(() => saveModuleAsPreset(dir, REF, "bad/name")).toThrow(
      /invalid preset name/,
    );
  });

  it("won't snapshot a module with nothing saved", () => {
    // The demo's synth has no params until something is set.
    expect(() => saveModuleAsPreset(dir, REF, "empty")).toThrow(
      /no params to snapshot/,
    );
  });

  it("says which preset is missing rather than applying nothing", () => {
    expect(() => applyPresetToModule(dir, REF, "nope")).toThrow(
      /no preset 'nope'/,
    );
  });

  it("is not read as a node of the module it sits beside", () => {
    // Every other `<name>.yaml` in a module folder is one USE of it, so this would read as "synth:presets".
    setModuleParam(dir, REF, "Filter Freq", 0.42);
    saveModuleAsPreset(dir, REF, "warm");
    expect(Object.keys(loadModuleRefs(dir))).not.toContain(
      "@workspace/instruments/synth:presets",
    );
  });

  it("reads a hand-authored shelf, and ignores one the schema refuses", () => {
    setModuleParam(dir, REF, "Filter Freq", 0.42);
    saveModuleAsPreset(dir, REF, "warm");
    applyPresetToModule(dir, REF, "warm");
    // A shelf is hand-editable; a broken one costs the presets, not the module.
    writeFileSync(
      modulePresetsFile(dir, REF) as string,
      "warm: not a mapping\n",
      "utf8",
    );
    expect(listModulePresets(dir, REF)).toEqual([]);
    expect(loadModuleRefs(dir)[REF]).toBeTruthy();
  });
});
