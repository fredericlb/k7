// The model is chosen once and then run for minutes, so every wrong answer here is expensive:
// a missing one must be a sentence with a remedy, and an ambiguous one must not be guessed at.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoModelError, stemsModel } from "./model";

let dir = "";
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pl8-models-"));
  process.env.STUDIO_MODELS_DIR = dir;
  process.env.STUDIO_STEMS_MODEL = undefined;
  delete process.env.STUDIO_STEMS_MODEL;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

const put = (name: string) => {
  const p = join(dir, name);
  writeFileSync(p, "");
  return p;
};

describe("finding the model", () => {
  it("takes the one .onnx in the models directory", () => {
    const p = put("htdemucs.onnx");
    expect(stemsModel()).toBe(p);
  });

  it("is case-insensitive about the extension, as a downloaded file may be", () => {
    const p = put("Model.ONNX");
    expect(stemsModel()).toBe(p);
  });

  it("REFUSES two rather than picking one — the wrong model separates into the wrong four files", () => {
    put("a.onnx");
    put("b.onnx");
    expect(() => stemsModel()).toThrow(NoModelError);
    expect(() => stemsModel()).toThrow(/name the one to use/);
  });

  it("says where to put one when there is none, rather than just failing", () => {
    expect(() => stemsModel()).toThrow(NoModelError);
    expect(() => stemsModel()).toThrow(new RegExp(dir.replace(/\\/g, "\\\\")));
  });

  it("ignores what is not a model", () => {
    put("notes.txt");
    expect(() => stemsModel()).toThrow(NoModelError);
  });
});

describe("STUDIO_STEMS_MODEL", () => {
  it("wins over the directory, so an ambiguous one can be resolved", () => {
    put("a.onnx");
    const chosen = put("b.onnx");
    process.env.STUDIO_STEMS_MODEL = chosen;
    expect(stemsModel()).toBe(chosen);
  });

  it("must be absolute — a relative path would resolve against the server's cwd", () => {
    process.env.STUDIO_STEMS_MODEL = "models/x.onnx";
    expect(() => stemsModel()).toThrow(/absolute/);
  });

  it("must exist, and the error names it", () => {
    const missing = join(dir, "nope.onnx");
    process.env.STUDIO_STEMS_MODEL = missing;
    expect(() => stemsModel()).toThrow(/nope\.onnx/);
  });
});
