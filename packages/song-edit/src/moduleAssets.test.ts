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
import { insertChainStepAfter, writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setModuleAsset } from "./projectEdit";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.k7");
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

/** A module file written directly into the workspace's `_modules` — a module lives at `@workspace` now. */
function module_(rel: string, value: Record<string, unknown>): string {
  const abs = join(dir, "..", "_modules", rel);
  writeDoc(abs, value);
  return abs;
}

/** An asset file under the workspace's `_modules`. */
const asset = (rel: string, body = "x"): string =>
  file(join("..", "_modules", rel), body);

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-assets-"));
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeDoc(join(dir, "project.k7x"), { project: { name: "song", tempo: 120 } });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const amp = () => loadModuleRefs(dir)["@workspace/audio/amp"];

describe("a file-valued param", () => {
  it("resolves out of the module's own assets folder", () => {
    module_("audio/amp/module.k7x", {
      plugin: { type: "internal" },
      params: { model: "jcm800.nam" },
    });
    const at = asset("audio/amp/assets/jcm800.nam");
    expect(amp()?.model).toBe(at);
    // The short name survives: it is what the module editor shows as the current choice.
    expect(amp()?.assets).toEqual({ model: "jcm800.nam" });
  });

  it("keeps its nesting, since a NAM pack is a folder per amp", () => {
    module_("audio/amp/module.k7x", {
      plugin: { type: "internal" },
      params: { model: "Two-Rock/Clean.nam" },
    });
    const at = asset("audio/amp/assets/Two-Rock/Clean.nam");
    expect(amp()?.model).toBe(at);
  });

  it("refuses a ref that climbs out of the assets folder", () => {
    // A reference resolves INSIDE the module or not at all, or it reads any file the service can.
    module_("audio/amp/module.k7x", {
      plugin: { type: "internal" },
      params: { model: "../../secret.nam" },
    });
    asset("secret.nam");
    expect(amp()?.model).toBeUndefined();
  });

  it("sits beside the numbers, and does not reach the engine as one", () => {
    // `params` on the wire is a float map mirrored in C++, so the model leaves as `namFile`.
    const proj = join(ws, "demo");
    cpSync(SONG, proj, { recursive: true });
    cpSync(DEMO_MODULES, join(ws, "_modules"), { recursive: true });
    mkdirSync(join(ws, "_modules", "audio", "amp", "assets"), {
      recursive: true,
    });
    writeDoc(join(ws, "_modules", "audio", "amp", "module.k7x"), {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { model: "jcm800.nam", Normalize: 1 },
    });
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
    // The numeric param travels, beside the engine's own stage; the file-valued one does not appear in `params` at all.
    expect(plugin?.params).toEqual({
      Normalize: 1,
      "@mix": 1,
      "@input-volume": 0,
      "@output-volume": 0,
    });
  });

  it("warns about a file the module doesn't carry, instead of loading nothing", () => {
    // An amp whose model did not load passes no sound at all, silently.
    const proj = join(ws, "demo");
    cpSync(SONG, proj, { recursive: true });
    cpSync(DEMO_MODULES, join(ws, "_modules"), { recursive: true });
    mkdirSync(join(ws, "_modules", "audio", "amp"), { recursive: true });
    writeDoc(join(ws, "_modules", "audio", "amp", "module.k7x"), {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { model: "does-not-exist.nam" },
    });
    insertChainStepAfter(proj, "lead", { module: "@workspace/audio/amp" });
    const w = loadGraph(proj).warnings;
    expect(w.some((m) => m.includes("does-not-exist.nam"))).toBe(true);
  });

  it("lets a node carry its own model, out of its OWN assets folder", () => {
    // Two amps sharing one module: the override merges per key, out of the node's own `assets/`.
    module_("audio/amp/module.k7x", {
      plugin: { type: "internal" },
      params: { model: "jcm800.nam", Input: -5 },
    });
    asset("audio/amp/assets/jcm800.nam");
    writeDoc(join(dir, "nodes", "clean.k7x"), {
      extends: "@workspace/audio/amp",
      params: { model: "twin.nam" },
    });
    file("nodes/assets/twin.nam");
    const mods = loadModules(dir);
    const refs = loadModuleRefs(dir, {});
    expect(refs["@workspace/audio/amp"]?.assets?.model).toBe("jcm800.nam");
    expect(mods.clean.assets?.model).toBe("twin.nam");
    // …and what it did NOT restate comes down through extends.
    const resolved = resolveModuleMap(mods, refs);
    expect(resolved.clean.params?.Input).toBe(-5);
  });

  it("writes a pick into the module's own file, and clears it again", () => {
    module_("audio/amp/module.k7x", { plugin: { type: "internal" } });
    asset("audio/amp/assets/jcm800.nam");
    asset("audio/amp/assets/twin.nam");
    const path = join(ws, "_modules", "audio", "amp", "module.k7x");

    setModuleAsset(dir, "@workspace/audio/amp", "model", "jcm800.nam");
    expect(readFileSync(path, "utf8")).toContain("jcm800.nam");
    expect(loadModuleRefs(dir)["@workspace/audio/amp"].assets?.model).toBe(
      "jcm800.nam",
    );

    // Choosing another replaces it rather than adding a second key.
    setModuleAsset(dir, "@workspace/audio/amp", "model", "twin.nam");
    const swapped = readFileSync(path, "utf8");
    expect(swapped).toContain("twin.nam");
    expect(swapped).not.toContain("jcm800");

    // Clearing takes the key away: `model: ""` would be a value that means nothing.
    setModuleAsset(dir, "@workspace/audio/amp", "model", null);
    expect(loadModuleRefs(dir)["@workspace/audio/amp"].assets).toBeUndefined();
  });
});

describe("what the dropdown offers", () => {
  it("lists the module's own assets, and only the files a param can load", () => {
    // A .wav is not a model; offering it would just be a way to pick something that can't load.
    module_("audio/amp/module.k7x", { plugin: { type: "internal" } });
    asset("audio/amp/assets/jcm800.nam");
    asset("audio/amp/assets/Two-Rock/Clean.nam");
    asset("audio/amp/assets/notes.wav");
    expect(listModuleAssets(join(ws, "_modules", "audio", "amp"))).toEqual([
      "Two-Rock/Clean.nam",
      "jcm800.nam",
    ]);
  });

  it("is empty for a module that carries nothing", () => {
    module_("audio/amp/module.k7x", { plugin: { type: "internal" } });
    expect(listModuleAssets(join(ws, "_modules", "audio", "amp"))).toEqual([]);
  });
});

describe("a rack's samples", () => {
  it("come from assets/ too, without dropping the old layout", () => {
    // `assets/` is where a dropped sample lands, and a shelf laid out the old way must still load.
    module_("instruments/kit/module.k7x", {
      type: "rack",
      rack: {
        rack_type: "samples",
        symbols: {
          bd: { note: 36, clip: "bd.wav" },
          sd: { note: 38, clip: "sd.wav" },
        },
      },
    });
    const inAssets = asset("instruments/kit/assets/bd.wav");
    const beside = asset("instruments/kit/sd.wav");
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
    module_("audio/sep/module.k7x", {
      cold: true,
      plugin: { type: "offline", name: "Stem Split" },
      params: { onnx: "htdemucs.onnx" },
    });

  it("falls back to the machine's cache when the module carries none", () => {
    sep();
    writeFileSync(join(models, "htdemucs.onnx"), "weights", "utf8");
    expect(loadModuleRefs(dir)["@workspace/audio/sep"]?.onnx).toBe(
      join(models, "htdemucs.onnx"),
    );
  });

  it("prefers the module's own copy when there is one", () => {
    sep();
    const own = asset("audio/sep/assets/htdemucs.onnx");
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
    module_("audio/sep/module.k7x", {
      plugin: { type: "offline" },
      params: { onnx: "../../../secret.onnx" },
    });
    writeFileSync(join(models, "secret.onnx"), "weights", "utf8");
    expect(loadModuleRefs(dir)["@workspace/audio/sep"]?.onnx).toBeUndefined();
  });
});
