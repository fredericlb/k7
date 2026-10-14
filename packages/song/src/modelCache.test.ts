// The two questions a model download asks of a module: what is missing, and where it may land.
// See docs/moduleAssets.md.

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { missingModel, modelCachePath, modelsRoot } from "./modelCache";

describe("missingModel", () => {
  it("is the authored name, and the model_url, when the model resolved to nothing", () => {
    expect(
      missingModel({
        assets: { onnx: "htdemucs.onnx" },
        model_url: "https://models.example/htdemucs.onnx",
      }),
    ).toEqual({
      file: "htdemucs.onnx",
      url: "https://models.example/htdemucs.onnx",
    });
  });

  it("still names the file when there is no model_url — nothing can fetch it, but it is missing", () => {
    expect(missingModel({ assets: { onnx: "htdemucs.onnx" } })).toEqual({
      file: "htdemucs.onnx",
    });
  });

  it("is null when the model resolved — the loader found it in assets/ or the cache", () => {
    expect(
      missingModel({
        assets: { onnx: "htdemucs.onnx" },
        onnx: "/home/me/.k7/models/htdemucs.onnx",
        model_url: "https://models.example/htdemucs.onnx",
      }),
    ).toBeNull();
  });

  it("is null for a module that names no model at all", () => {
    expect(missingModel({})).toBeNull();
    expect(missingModel({ model_url: "https://x.example/m.onnx" })).toBeNull();
  });
});

describe("modelCachePath", () => {
  let before: string | undefined;
  beforeEach(() => {
    before = process.env.STUDIO_MODELS;
    process.env.STUDIO_MODELS = "/tmp/k7-models-test";
  });
  afterEach(() => {
    if (before === undefined) delete process.env.STUDIO_MODELS;
    else process.env.STUDIO_MODELS = before;
  });

  it("lands a model inside the cache, a sub-folder included", () => {
    expect(modelCachePath("htdemucs.onnx")).toBe(
      join(modelsRoot(), "htdemucs.onnx"),
    );
    expect(modelCachePath("demucs/v4.onnx")).toBe(
      join(modelsRoot(), "demucs", "v4.onnx"),
    );
  });

  it("refuses a name that would leave the cache, rather than cleaning it", () => {
    // The name is authored in a library: a `../` in it must not choose where a download is written.
    expect(modelCachePath("../evil.onnx")).toBeNull();
    expect(modelCachePath("a/../../evil.onnx")).toBeNull();
    expect(modelCachePath("/etc/evil.onnx")).toBeNull();
    expect(modelCachePath("")).toBeNull();
  });
});
