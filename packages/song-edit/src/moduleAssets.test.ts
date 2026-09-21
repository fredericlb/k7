// A module carries the files it loads, in its own `assets/`, named in `params:` — packages/song/docs/moduleAssets.md.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph } from "@studio/song/graph";
import {
  listModuleAssets,
  loadModuleRefs,
  loadModules,
} from "@studio/song/loader";
import { resolveModuleMap } from "@studio/song/moduleResolve";
import { compileNodeProject } from "@studio/song/nodeProject";
import { insertChainStepAfter } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setModuleAsset } from "./projectEdit";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");
const DEMO_MODULES = join(here, "..", "..", "..", "demos", "_modules");

let ws: string;
let dir: string;

/** A file at `rel` under the WORKSPACE (`_modules/...`) or the project, folders created. */
function file(rel: string, body = "x"): string {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
  return abs;
}

/** A module written directly into the workspace's `_modules` — a module lives at `@workspace` now. */
function module_(rel: string, body: string): string {
  return file(join("..", "_modules", rel), body);
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-assets-"));
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const amp = () => loadModuleRefs(dir)["@workspace/audio/amp"];

describe("a file-valued param", () => {
  it("resolves out of the module's own assets folder", () => {
    module_(
      "audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "jcm800.nam"\n',
    );
    const at = module_("audio/amp/assets/jcm800.nam", "x");
    expect(amp()?.nam).toBe(at);
    // The short name survives: it is what the module editor shows as the current choice.
    expect(amp()?.assets).toEqual({ nam: "jcm800.nam" });
  });

  it("keeps its nesting, since a NAM pack is a folder per amp", () => {
    module_(
      "audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "Two-Rock/Clean.nam"\n',
    );
    const at = module_("audio/amp/assets/Two-Rock/Clean.nam", "x");
    expect(amp()?.nam).toBe(at);
  });

  it("refuses a ref that climbs out of the assets folder", () => {
    // A reference resolves INSIDE the module or not at all, or it reads any file the service can.
    module_(
      "audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "../../secret.nam"\n',
    );
    module_("secret.nam", "x");
    expect(amp()?.nam).toBeUndefined();
  });

  it("sits beside the numbers, and does not reach the engine as one", () => {
    // `params` on the wire is a float map mirrored in C++, so the model leaves as `namFile`.
    const proj = join(ws, "demo");
    cpSync(SONG, proj, { recursive: true });
    cpSync(DEMO_MODULES, join(ws, "_modules"), { recursive: true });
    mkdirSync(join(ws, "_modules", "audio", "amp", "assets"), {
      recursive: true,
    });
    writeFileSync(
      join(ws, "_modules", "audio", "amp", "module.yaml"),
      "plugin:\n  type: internal\n  name: Neural Amp Modeler\n" +
        'params:\n  nam: "jcm800.nam"\n  Input: -5\n',
      "utf8",
    );
    writeFileSync(
      join(ws, "_modules", "audio", "amp", "assets", "jcm800.nam"),
      "{}",
      "utf8",
    );
    insertChainStepAfter(proj, "lead", { module: "@workspace/audio/amp" });

    const melody = compileNodeProject(proj).tracks.find(
      (t) => t.id === "melody",
    );
    const plugin = melody?.plugins.find((p) =>
      p.id.endsWith(":@workspace/audio/amp"),
    );
    expect(plugin?.namFile).toBe(
      join(ws, "_modules", "audio", "amp", "assets", "jcm800.nam"),
    );
    // The numeric param travels; the file-valued one does not appear in `params` at all.
    expect(plugin?.params).toEqual({ Input: -5 });
  });

  it("warns about a file the module doesn't carry, instead of loading nothing", () => {
    // An amp whose model did not load passes no sound at all, silently.
    const proj = join(ws, "demo");
    cpSync(SONG, proj, { recursive: true });
    cpSync(DEMO_MODULES, join(ws, "_modules"), { recursive: true });
    mkdirSync(join(ws, "_modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(ws, "_modules", "audio", "amp", "module.yaml"),
      "plugin:\n  type: internal\n  name: Neural Amp Modeler\n" +
        'params:\n  nam: "does-not-exist.nam"\n',
      "utf8",
    );
    insertChainStepAfter(proj, "lead", { module: "@workspace/audio/amp" });
    const w = loadGraph(proj).warnings;
    expect(w.some((m) => m.includes("does-not-exist.nam"))).toBe(true);
  });

  it("lets a node carry its own model, out of its OWN assets folder", () => {
    // Two amps sharing one module: the override merges per key, out of the node's own `assets/`.
    module_(
      "audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "jcm800.nam"\n  Input: -5\n',
    );
    module_("audio/amp/assets/jcm800.nam", "x");
    file(
      "nodes/clean.yaml",
      'extends: "@workspace/audio/amp"\nparams:\n  nam: "twin.nam"\n',
    );
    file("nodes/assets/twin.nam");
    const mods = loadModules(dir);
    const refs = loadModuleRefs(dir, {});
    expect(refs["@workspace/audio/amp"]?.assets?.nam).toBe("jcm800.nam");
    expect(mods.clean.assets?.nam).toBe("twin.nam");
    // …and what it did NOT restate comes down through extends.
    const resolved = resolveModuleMap(mods, refs);
    expect(resolved.clean.params?.Input).toBe(-5);
  });

  it("writes a pick into the module's own file, and clears it again", () => {
    module_("audio/amp/module.yaml", "plugin: {type: internal}\n");
    module_("audio/amp/assets/jcm800.nam", "x");
    module_("audio/amp/assets/twin.nam", "x");
    const path = join(ws, "_modules", "audio", "amp", "module.yaml");

    setModuleAsset(dir, "@workspace/audio/amp", "nam", "jcm800.nam");
    expect(readFileSync(path, "utf8")).toContain("jcm800.nam");
    expect(loadModuleRefs(dir)["@workspace/audio/amp"].assets?.nam).toBe(
      "jcm800.nam",
    );

    // Choosing another replaces it rather than adding a second key.
    setModuleAsset(dir, "@workspace/audio/amp", "nam", "twin.nam");
    const swapped = readFileSync(path, "utf8");
    expect(swapped).toContain("twin.nam");
    expect(swapped).not.toContain("jcm800");

    // Clearing takes the key away: `nam: ""` would be a value that means nothing.
    setModuleAsset(dir, "@workspace/audio/amp", "nam", null);
    expect(loadModuleRefs(dir)["@workspace/audio/amp"].assets).toBeUndefined();
  });
});

describe("what the dropdown offers", () => {
  it("lists the module's own assets, and only the files a param can load", () => {
    // A .wav is not a model; offering it would just be a way to pick something that can't load.
    module_("audio/amp/module.yaml", "plugin: {type: internal}\n");
    module_("audio/amp/assets/jcm800.nam", "x");
    module_("audio/amp/assets/Two-Rock/Clean.nam", "x");
    module_("audio/amp/assets/notes.wav", "x");
    expect(
      listModuleAssets(join(ws, "_modules", "audio", "amp")),
    ).toEqual(["Two-Rock/Clean.nam", "jcm800.nam"]);
  });

  it("is empty for a module that carries nothing", () => {
    module_("audio/amp/module.yaml", "plugin: {type: internal}\n");
    expect(
      listModuleAssets(join(ws, "_modules", "audio", "amp")),
    ).toEqual([]);
  });
});

describe("a rack's samples", () => {
  it("come from assets/ too, without dropping the old layout", () => {
    // `assets/` is where a dropped sample lands, and a shelf laid out the old way must still load.
    module_(
      "instruments/kit/module.yaml",
      "type: rack\nrack:\n  rack_type: samples\n  symbols:\n" +
        '    bd: { note: 36, clip: "bd.wav" }\n' +
        '    sd: { note: 38, clip: "sd.wav" }\n',
    );
    const inAssets = module_("instruments/kit/assets/bd.wav", "x");
    const beside = module_("instruments/kit/sd.wav", "x");
    const rack = loadModuleRefs(dir)["@workspace/instruments/kit"]?.rack;
    expect(rack?.symbols?.bd?.clip).toBe(inAssets);
    expect(rack?.symbols?.sd?.clip).toBe(beside);
  });
});

// A neural model resolves like an amp profile, except the module DECLARES it and the machine holds it.
describe("a model too big to carry", () => {
  let models: string;

  beforeEach(() => {
    models = mkdtempSync(join(tmpdir(), "td-models-"));
    process.env.STUDIO_MODELS = models;
  });
  afterEach(() => {
    process.env.STUDIO_MODELS = undefined;
    rmSync(models, { recursive: true, force: true });
  });

  const sep = () =>
    module_(
      "audio/sep/module.yaml",
      "cold: true\nplugin: {type: offline, name: Stem Split}\n" +
        "params: {onnx: htdemucs.onnx}\n",
    );

  it("falls back to the machine's cache when the module carries none", () => {
    sep();
    writeFileSync(join(models, "htdemucs.onnx"), "weights", "utf8");
    expect(loadModuleRefs(dir)["@workspace/audio/sep"]?.onnx).toBe(
      join(models, "htdemucs.onnx"),
    );
  });

  it("prefers the module's own copy when there is one", () => {
    sep();
    const own = module_("audio/sep/assets/htdemucs.onnx", "x");
    writeFileSync(join(models, "htdemucs.onnx"), "weights", "utf8");
    expect(loadModuleRefs(dir)["@workspace/audio/sep"]?.onnx).toBe(own);
  });

  it("resolves to nothing when neither has it, and keeps the authored name", () => {
    sep();
    const m = loadModuleRefs(dir)["@workspace/audio/sep"];
    // The disagreement between the two is how validate() reports a dangling ref.
    expect(m?.onnx).toBeUndefined();
    expect(m?.assets?.onnx).toBe("htdemucs.onnx");
  });

  it("refuses a ref that climbs out, rather than redirecting it to the cache", () => {
    // The containment check comes FIRST and refuses; it does not fall through to the cache.
    module_(
      "audio/sep/module.yaml",
      "plugin: {type: offline}\nparams: {onnx: ../../../secret.onnx}\n",
    );
    writeFileSync(join(models, "secret.onnx"), "weights", "utf8");
    expect(
      loadModuleRefs(dir)["@workspace/audio/sep"]?.onnx,
    ).toBeUndefined();
  });
});
