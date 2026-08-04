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
import { loadModules } from "@studio/song/loader";
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
const REF = "instruments/synth"; // the synth module's own ref

// A preset is a NAME and the values it sets, and the whole shelf is one file in the module's folder — the
// third sibling of module.yaml and ui.yaml. What these pin down is that the round trip survives the file
// (save, list, apply), and that the module folder's own three files are never mistaken for instances of it.

// modulePresetsFile is pure string work — no fs — so it always runs.
describe("modulePresetsFile", () => {
  it("maps a local plugin ref to the presets.yaml in its module folder", () => {
    expect(modulePresetsFile("/song", REF)).toBe(
      join("/song", "modules", "instruments", "synth", "presets.yaml"),
    );
  });
  it("declines io, inherited, and malformed refs (nowhere local to store them)", () => {
    expect(modulePresetsFile("/song", "OUT")).toBeNull(); // io sink, bare name
    expect(modulePresetsFile("/song", "@lib/instruments/x")).toBeNull(); // inherited
    expect(modulePresetsFile("/song", "io/whatever")).toBeNull(); // io kind
  });
});

describe("presets round-trip (synth-demo)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-presets-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const shelf = () =>
    readFileSync(modulePresetsFile(dir, REF) as string, "utf8");

  it("saves a module's params as a preset, lists it, and applies it back", () => {
    // Give the module a param to snapshot (the demo's synth rides its base's defaults).
    setModuleParam(dir, "synth", "Filter Freq", 0.42);
    expect(hasPresets(dir, REF)).toBe(false);

    const rel = saveModuleAsPreset(dir, "synth", "warm");
    expect(rel).toBe(join("modules", "instruments", "synth", "presets.yaml"));
    expect(hasPresets(dir, REF)).toBe(true);

    const presets = listModulePresets(dir, REF);
    expect(presets.map((p) => ({ name: p.name, source: p.source }))).toEqual([
      { name: "warm", source: "user" },
    ]);

    // Move the live value away, then apply the preset and confirm it's restored.
    setModuleParam(dir, "synth", "Filter Freq", 0.9);
    applyPresetToModule(dir, "synth", presets[0].name);
    const mod = loadModules(dir) as Record<
      string,
      { params?: Record<string, number> }
    >;
    expect(mod.synth.params?.["Filter Freq"]).toBeCloseTo(0.42, 6);
  });

  it("writes one preset per LINE, so adding a second is a one-line diff", () => {
    setModuleParam(dir, "synth", "Filter Freq", 0.42);
    saveModuleAsPreset(dir, "synth", "warm");
    setModuleParam(dir, "synth", "Filter Freq", 0.9);
    saveModuleAsPreset(dir, "synth", "bright");
    const lines = shelf().trim().split("\n");
    expect(lines[0]).toMatch(/^# presets for instruments\/synth$/);
    // A param name with a space needs no quotes as a YAML key, and quoting it anyway would put noise in
    // every line of every shelf — the names plugins use are almost all like this.
    expect(lines[1]).toBe("warm: { Filter Freq: 0.42 }");
    expect(lines[2]).toBe("bright: { Filter Freq: 0.9 }");
  });

  it("keeps the presets that were already there when it adds one", () => {
    setModuleParam(dir, "synth", "Filter Freq", 0.42);
    saveModuleAsPreset(dir, "synth", "warm");
    setModuleParam(dir, "synth", "Filter Freq", 0.9);
    saveModuleAsPreset(dir, "synth", "bright");
    expect(
      listModulePresets(dir, REF)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["bright", "warm"]);
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
    // The demo's synth has no params until something is set.
    expect(() => saveModuleAsPreset(dir, "synth", "empty")).toThrow(
      /no params to snapshot/,
    );
  });

  it("says which preset is missing rather than applying nothing", () => {
    expect(() => applyPresetToModule(dir, "synth", "nope")).toThrow(
      /no preset 'nope'/,
    );
  });

  it("is not read as an instance of the module it sits beside", () => {
    // The same hazard `ui.yaml` has: every other `<name>.yaml` in a module folder is one USE of the module,
    // so an unguarded shelf would come back as a module called "synth:presets".
    setModuleParam(dir, "synth", "Filter Freq", 0.42);
    saveModuleAsPreset(dir, "synth", "warm");
    expect(Object.keys(loadModules(dir))).not.toContain("synth:presets");
  });

  it("reads a hand-authored shelf, and ignores one the schema refuses", () => {
    setModuleParam(dir, "synth", "Filter Freq", 0.42);
    saveModuleAsPreset(dir, "synth", "warm");
    applyPresetToModule(dir, "synth", "warm");
    // A shelf is hand-editable; a broken one costs the presets, not the module.
    writeFileSync(
      modulePresetsFile(dir, REF) as string,
      "warm: not a mapping\n",
      "utf8",
    );
    expect(listModulePresets(dir, REF)).toEqual([]);
    expect(loadModules(dir).synth).toBeTruthy();
  });
});
