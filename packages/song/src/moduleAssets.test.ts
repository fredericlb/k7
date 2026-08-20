// A module carries the files it loads: an `assets/` folder inside the module, holding the amp
// profile it names. What is pinned here is that the module is SELF-CONTAINED — it survives a
// fork, an upload to the médiathèque and a sync onto a machine that has none of the song's
// other files — and that the file is named in `params:`, like every other control the plugin
// has. See docs/moduleAssets.md.

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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { listModuleAssets, loadModuleRefs, loadModules } from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import { compileNodeProject } from "./nodeProject";
import { setModuleAsset } from "./projectEdit";
import { insertChainStepAfter, writeModule } from "./testSupport";

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
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

let ws: string;
let dir: string;

/** A file at `rel` under the project, folders created. */
function file(rel: string, body = "x"): string {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
  return abs;
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

const amp = () => loadModules(dir)["amp"];

describe("a file-valued param", () => {
  it("resolves out of the module's own assets folder", () => {
    file(
      "modules/audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "jcm800.nam"\n',
    );
    const at = file("modules/audio/amp/assets/jcm800.nam");
    expect(amp()?.nam).toBe(at);
    // The short name survives: it is what the module editor shows as the current choice.
    expect(amp()?.assets).toEqual({ nam: "jcm800.nam" });
  });

  it("keeps its nesting, since a NAM pack is a folder per amp", () => {
    file(
      "modules/audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "Two-Rock/Clean.nam"\n',
    );
    const at = file("modules/audio/amp/assets/Two-Rock/Clean.nam");
    expect(amp()?.nam).toBe(at);
  });

  it("refuses a ref that climbs out of the assets folder", () => {
    // These come from files an editor writes into a workspace that may be shared, so a
    // reference resolves INSIDE the module or not at all — without this it would be a way to
    // read any file the service can see.
    file(
      "modules/audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "../../secret.nam"\n',
    );
    file("modules/secret.nam");
    expect(amp()?.nam).toBeUndefined();
  });

  it("sits beside the numbers, and does not reach the engine as one", () => {
    // The authored shape changed; the protocol did not. `params` on the wire is a float map
    // mirrored in C++, so the model leaves as its own `namFile` field — which is what the
    // engine already expected.
    const proj = join(ws, "demo");
    cpSync(SONG, proj, { recursive: true });
    writeModule(proj, "audio", "amp", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { nam: "jcm800.nam", Input: -5 },
    });
    mkdirSync(join(proj, "modules", "audio", "amp", "assets"), {
      recursive: true,
    });
    writeFileSync(
      join(proj, "modules", "audio", "amp", "assets", "jcm800.nam"),
      "{}",
      "utf8",
    );
    insertChainStepAfter(proj, "lead", { module: "amp" });

    const melody = compileNodeProject(proj).tracks.find(
      (t) => t.id === "melody",
    );
    const plugin = melody?.plugins.find((p) => p.id.endsWith(":amp"));
    expect(plugin?.namFile).toBe(
      join(proj, "modules", "audio", "amp", "assets", "jcm800.nam"),
    );
    // The numeric param travels; the file-valued one does not appear in `params` at all.
    expect(plugin?.params).toEqual({ Input: -5 });
  });

  it("warns about a file the module doesn't carry, instead of loading nothing", () => {
    // Silence with no explanation is the failure mode worth spending a warning on: an amp
    // whose model didn't load passes no sound at all.
    const proj = join(ws, "demo");
    cpSync(SONG, proj, { recursive: true });
    writeModule(proj, "audio", "amp", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { nam: "does-not-exist.nam" },
    });
    insertChainStepAfter(proj, "lead", { module: "amp" });
    const w = loadGraph(proj).warnings;
    expect(w.some((m) => m.includes("does-not-exist.nam"))).toBe(true);
  });

  it("lets a node carry its own model, out of its OWN assets folder", () => {
    // Two amps sharing one module, each with its own profile — and because it is a param, the
    // override merges per key, so the node keeps the module's other settings.
    //
    // The node's model sits in `nodes/assets/`, not in the module's: what belongs to
    // one use of a module lives beside that use, which is what lets `nodes/` stay flat.
    file(
      "modules/audio/amp/module.yaml",
      'plugin: {type: internal}\nparams:\n  nam: "jcm800.nam"\n  Input: -5\n',
    );
    file("modules/audio/amp/assets/jcm800.nam");
    file(
      "nodes/clean.yaml",
      'extends: "@project/audio/amp"\nparams:\n  nam: "twin.nam"\n',
    );
    file("nodes/assets/twin.nam");
    const mods = loadModules(dir);
    expect(mods.amp.assets?.nam).toBe("jcm800.nam");
    expect(mods.clean.assets?.nam).toBe("twin.nam");
    // …and what it did NOT restate comes down through extends.
    const resolved = resolveModuleMap(mods, loadModuleRefs(dir, {}));
    expect(resolved.clean.params?.Input).toBe(-5);
  });

  it("writes a pick into the module's own file, and clears it again", () => {
    file("modules/audio/amp/module.yaml", "plugin: {type: internal}\n");
    file("modules/audio/amp/assets/jcm800.nam");
    file("modules/audio/amp/assets/twin.nam");
    const path = join(dir, "modules", "audio", "amp", "module.yaml");

    setModuleAsset(dir, "amp", "nam", "jcm800.nam");
    expect(readFileSync(path, "utf8")).toContain("jcm800.nam");
    expect(loadModules(dir).amp.assets?.nam).toBe("jcm800.nam");

    // Choosing another replaces it rather than adding a second key.
    setModuleAsset(dir, "amp", "nam", "twin.nam");
    const swapped = readFileSync(path, "utf8");
    expect(swapped).toContain("twin.nam");
    expect(swapped).not.toContain("jcm800");

    // Clearing takes the key away — an amp with no model is a legitimate state, and `nam: ""`
    // would be a value that means nothing.
    setModuleAsset(dir, "amp", "nam", null);
    expect(loadModules(dir).amp.assets).toBeUndefined();
  });
});

describe("what the dropdown offers", () => {
  it("lists the module's own assets, and only the files a param can load", () => {
    // A .wav is not a model; offering it would just be a way to pick something that can't load.
    file("modules/audio/amp/module.yaml", "plugin: {type: internal}\n");
    file("modules/audio/amp/assets/jcm800.nam");
    file("modules/audio/amp/assets/Two-Rock/Clean.nam");
    file("modules/audio/amp/assets/notes.wav");
    expect(listModuleAssets(join(dir, "modules", "audio", "amp"))).toEqual([
      "Two-Rock/Clean.nam",
      "jcm800.nam",
    ]);
  });

  it("is empty for a module that carries nothing", () => {
    file("modules/audio/amp/module.yaml", "plugin: {type: internal}\n");
    expect(listModuleAssets(join(dir, "modules", "audio", "amp"))).toEqual([]);
  });
});

describe("a rack's samples", () => {
  it("come from assets/ too, without dropping the old layout", () => {
    // A shelf's audio is resolved against the module folder already; `assets/` is where a
    // dropped sample now lands, and a shelf laid out the old way must keep loading.
    file(
      "modules/instruments/kit/module.yaml",
      "type: rack\nrack:\n  rack_type: samples\n  symbols:\n" +
        '    bd: { note: 36, clip: "bd.wav" }\n' +
        '    sd: { note: 38, clip: "sd.wav" }\n',
    );
    const inAssets = file("modules/instruments/kit/assets/bd.wav");
    const beside = file("modules/instruments/kit/sd.wav");
    const rack = loadModules(dir)["kit"]?.rack;
    expect(rack?.symbols?.bd?.clip).toBe(inAssets);
    expect(rack?.symbols?.sd?.clip).toBe(beside);
  });
});

// A neural model is named exactly like an amp profile, and resolves the same way — except that
// 166 MB does not travel through a fork, so the module DECLARES it and the machine holds the
// bytes. See docs/moduleAssets.md's note on the model cache.
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

  const amp = () =>
    file(
      "modules/audio/sep/module.yaml",
      "cold: true\nplugin: {type: offline, name: Stem Split}\n" +
        "params: {onnx: htdemucs.onnx}\n",
    );

  it("falls back to the machine's cache when the module carries none", () => {
    amp();
    writeFileSync(join(models, "htdemucs.onnx"), "weights", "utf8");
    expect(loadModules(dir)["sep"]?.onnx).toBe(join(models, "htdemucs.onnx"));
  });

  it("prefers the module's own copy when there is one", () => {
    amp();
    const own = file("modules/audio/sep/assets/htdemucs.onnx");
    writeFileSync(join(models, "htdemucs.onnx"), "weights", "utf8");
    expect(loadModules(dir)["sep"]?.onnx).toBe(own);
  });

  it("resolves to nothing when neither has it, and keeps the authored name", () => {
    amp();
    const m = loadModules(dir)["sep"];
    // The disagreement between the two is how validate() reports a dangling ref.
    expect(m?.onnx).toBeUndefined();
    expect(m?.assets?.onnx).toBe("htdemucs.onnx");
  });

  it("refuses a ref that climbs out, rather than redirecting it to the cache", () => {
    // The cache must not become a way to launder an escaping ref: the containment check comes
    // first and REFUSES, it does not fall through.
    file(
      "modules/audio/sep/module.yaml",
      "plugin: {type: offline}\nparams: {onnx: ../../../secret.onnx}\n",
    );
    writeFileSync(join(models, "secret.onnx"), "weights", "utf8");
    expect(loadModules(dir)["sep"]?.onnx).toBeUndefined();
  });
});
