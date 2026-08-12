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
  loadControllerLibrary,
  moduleControllerFile,
  parseController,
  readModuleController,
  setCcBinding,
} from "./controller";
import { bindModuleCc } from "./controllerBind";
import { loadGraph } from "./graph";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);
const REF = "instruments/synth";

// A module's MIDI map is one file in its folder — the FOURTH sibling of module.yaml, ui.yaml and
// presets.yaml. What these pin down is that it round-trips, that it reaches the graph the panel
// reaches, and that the folder's own files are never mistaken for nodes of the module.

describe("parseController", () => {
  it("reads a hand-authored map", () => {
    expect(parseController("Cutoff: { ch: 1, cc: 74 }\n").value).toEqual({
      Cutoff: { ch: 1, cc: 74 },
    });
  });

  it("reads an absent map as empty rather than failing", () => {
    expect(parseController("").value).toEqual({});
  });

  it("refuses a channel outside 1-16 and a cc outside 0-127", () => {
    // 1-based as a musician counts them: channel 0 is a typo for 1, not the wire's channel 1.
    expect(parseController("Cutoff: { ch: 0, cc: 74 }\n").value).toBeNull();
    expect(parseController("Cutoff: { ch: 17, cc: 74 }\n").value).toBeNull();
    expect(parseController("Cutoff: { ch: 1, cc: 128 }\n").value).toBeNull();
  });

  it("names what is wrong instead of throwing", () => {
    const bad = parseController("Cutoff: { ch: 1, cc: 999 }\n");
    expect(bad.value).toBeNull();
    expect(bad.issue).toMatch(/Cutoff\.cc/);
  });

  it("refuses a binding missing its channel — half a binding plays nothing", () => {
    expect(parseController("Cutoff: { cc: 74 }\n").value).toBeNull();
  });
});

describe("a module's MIDI map (synth-demo)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-controller-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const mapText = () =>
    readFileSync(moduleControllerFile(dir, REF) as string, "utf8");

  it("binds, reads back, and unbinds", () => {
    const rel = setCcBinding(dir, REF, "Filter Freq", { ch: 1, cc: 74 });
    expect(rel).toBe(
      join("modules", "instruments", "synth", "controller.yaml"),
    );
    expect(readModuleController(dir, REF)).toEqual({
      "Filter Freq": { ch: 1, cc: 74 },
    });

    setCcBinding(dir, REF, "Filter Freq", null);
    expect(readModuleController(dir, REF)).toEqual({});
  });

  it("keeps the bindings already there when it adds one", () => {
    setCcBinding(dir, REF, "Filter Freq", { ch: 1, cc: 74 });
    setCcBinding(dir, REF, "Resonance", { ch: 1, cc: 71 });
    expect(Object.keys(readModuleController(dir, REF)).sort()).toEqual([
      "Filter Freq",
      "Resonance",
    ]);
  });

  it("rebinds a param rather than keeping two controls on it", () => {
    // Two controls fighting over one value is a bug, not a feature — the key is the param.
    setCcBinding(dir, REF, "Filter Freq", { ch: 1, cc: 74 });
    setCcBinding(dir, REF, "Filter Freq", { ch: 2, cc: 21 });
    expect(readModuleController(dir, REF)).toEqual({
      "Filter Freq": { ch: 2, cc: 21 },
    });
  });

  it("writes one binding per LINE, so adding a second is a one-line diff", () => {
    setCcBinding(dir, REF, "Filter Freq", { ch: 1, cc: 74 });
    setCcBinding(dir, REF, "Resonance", { ch: 1, cc: 71 });
    const lines = mapText().trim().split("\n");
    expect(lines[0]).toMatch(/^# MIDI map for instruments\/synth/);
    // A param name with a space needs no quotes as a YAML key — the names plugins use are almost
    // all like this, and quoting them would put noise in every line of every map.
    expect(lines[1]).toBe("Filter Freq: { ch: 1, cc: 74 }");
    expect(lines[2]).toBe("Resonance: { ch: 1, cc: 71 }");
  });

  it("is not read as a node of the module it sits beside", () => {
    // The hazard ui.yaml and presets.yaml both have: every OTHER `<name>.yaml` in a module folder
    // is one USE of the module, so an unguarded map comes back as a module called "synth:controller".
    setCcBinding(dir, REF, "Filter Freq", { ch: 1, cc: 74 });
    expect(Object.keys(loadModules(dir))).not.toContain("synth:controller");
  });

  it("reaches the module the loader hands on", () => {
    setCcBinding(dir, REF, "Filter Freq", { ch: 1, cc: 74 });
    const mods = loadModules(dir) as Record<string, { cc?: unknown }>;
    expect(mods.synth.cc).toEqual({ "Filter Freq": { ch: 1, cc: 74 } });
  });

  it("reaches the GRAPH's module, which is what the panel is drawn from", () => {
    setCcBinding(dir, REF, "Filter Freq", { ch: 1, cc: 74 });
    const g = loadGraph(dir) as { modules?: Record<string, { cc?: unknown }> };
    expect(g.modules?.synth?.cc).toEqual({ "Filter Freq": { ch: 1, cc: 74 } });
  });

  it("ignores a map the schema refuses rather than losing the module", () => {
    const path = moduleControllerFile(dir, REF) as string;
    writeFileSync(path, "Filter Freq: { ch: 99, cc: 74 }\n", "utf8");
    const lib = loadControllerLibrary(dir);
    expect(lib.byRef[REF]).toBeUndefined();
    expect(lib.issues.join(" ")).toMatch(/controller\.yaml/);
    // …and the module still loads, with no map.
    const mods = loadModules(dir) as Record<string, { cc?: unknown }>;
    expect(mods.synth).toBeTruthy();
    expect(mods.synth.cc).toBeUndefined();
  });

  it("binds through the name a CHAIN uses, not just a ref", () => {
    const { rel, ref } = bindModuleCc(dir, "synth", "Filter Freq", {
      ch: 3,
      cc: 12,
    });
    expect(ref).toBe(REF);
    expect(rel).toBe(
      join("modules", "instruments", "synth", "controller.yaml"),
    );
    expect(readModuleController(dir, REF)["Filter Freq"]).toEqual({
      ch: 3,
      cc: 12,
    });
  });

  it("says which module has no folder rather than writing nowhere", () => {
    expect(() => bindModuleCc(dir, "nope", "Cutoff", { ch: 1, cc: 1 })).toThrow(
      /no module "nope"/,
    );
  });
});
