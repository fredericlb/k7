// How the Chains tab draws an `offline` module — a deck's tempo is one.
//
// The mirror image of jsdspGraph.test.ts, and the trap is that they look alike. Both formats
// are `known`, so neither node goes red. But `jsdsp` becomes a real plugin in the compiled
// document and `offline` becomes NOTHING: the compiler reads the type and skips the emit.
//
// So a pluginId here names an address no document contains, and everything downstream believes
// it: a tempo fader sends `set-plugin-param` to `deckA:tempoA` for ever, and the panel draws a
// knob that moves and changes nothing.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyAsYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");
const SONG = join(DEMOS, "synth-demo.st0");

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fs-offline-"));
  dir = join(root, "synth-demo.st0");
  copyAsYaml(SONG, dir, { recursive: true });
  // The demo's own "synth" lives at `@workspace`, its sibling in the Examples workspace.
  const demoModules = join(DEMOS, "_modules");
  if (existsSync(demoModules))
    copyAsYaml(demoModules, join(root, "_modules"), { recursive: true });
  const folder = join(root, "_modules", "instruments", "synth");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "cold: true\nplugin:\n  type: offline\n  name: Tempo\nparams:\n  Target BPM: 0\n",
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lead = () =>
  buildGraphDoc(dir).chains.melody?.use.find((s) => s.module === "lead");

describe("an offline module in the graph", () => {
  it("carries NO pluginId, because the document will carry no plugin", () => {
    // `offline` means realised outside the graph, and the address of that is the TRACK.
    expect(lead()?.pluginId).toBeUndefined();
  });

  it("is still not flagged as a plugin the engine cannot load", () => {
    // The colour and the address are separate facts: this module loads nothing BY DESIGN.
    expect(lead()?.unknownPlugin).toBeUndefined();
    expect(lead()?.notSupported).toBeUndefined();
  });

  it("still carries its declared params, which are all it can show", () => {
    // `liveParams` is keyed by plugin id and there is none, so the panel draws what the file says.
    expect(lead()?.params).toMatchObject({ "Target BPM": 0 });
  });
});

// The right-click's "Download model": offered on a node whose model is missing AND whose module says where it lives.
describe("a module that needs a model", () => {
  let models: string;
  const needsModel = (extra: string) =>
    writeFileSync(
      join(root, "_modules", "instruments", "synth", "module.yaml"),
      `cold: true\nplugin:\n  type: offline\n  name: Stem Split\nparams:\n  onnx: htdemucs.onnx\n${extra}`,
      "utf8",
    );
  beforeEach(() => {
    models = join(root, "models");
    mkdirSync(models, { recursive: true });
    process.env.STUDIO_MODELS = models;
  });
  afterEach(() => {
    delete process.env.STUDIO_MODELS;
  });

  it("carries what to download, when the model is missing and model_url says where", () => {
    needsModel("model_url: https://models.example/htdemucs.onnx\n");
    expect(lead()?.modelDownload).toEqual({
      file: "htdemucs.onnx",
      url: "https://models.example/htdemucs.onnx",
    });
  });

  it("carries nothing without a model_url — there is nothing to offer", () => {
    needsModel("");
    expect(lead()?.modelDownload).toBeUndefined();
  });

  it("carries nothing once the model is on the machine", () => {
    needsModel("model_url: https://models.example/htdemucs.onnx\n");
    writeFileSync(join(models, "htdemucs.onnx"), "a model");
    expect(lead()?.modelDownload).toBeUndefined();
  });
});
