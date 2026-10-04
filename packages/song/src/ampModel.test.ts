// What an amp model file says about itself, read as the engine reads it: the runtime by the keys
// present, the knobs as every input past the sound.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ampModelInfo, ampModelOfJson } from "./ampModel";

const aida = (inputs: number) => ({
  in_shape: [null, null, inputs],
  layers: [],
});
const proteus = (input_size?: number) => ({
  model_data: input_size === undefined ? {} : { input_size },
  state_dict: {},
});

describe("an amp model's knobs", () => {
  it("counts an AIDA-X net's inputs past the sound", () => {
    expect(ampModelOfJson(aida(1))).toEqual({ kind: "aida-x", knobs: 0 });
    expect(ampModelOfJson(aida(3))).toEqual({ kind: "aida-x", knobs: 2 });
  });

  it("reads a Proteus net, whose absent input_size is the sound alone", () => {
    expect(ampModelOfJson(proteus(2))).toEqual({ kind: "proteus", knobs: 1 });
    expect(ampModelOfJson(proteus())).toEqual({ kind: "proteus", knobs: 0 });
  });

  it("caps at the three knobs the plugin has", () => {
    expect(ampModelOfJson(aida(9))?.knobs).toBe(3);
  });

  it("refuses a json that is neither format", () => {
    expect(ampModelOfJson({ hello: 1 })).toBeNull();
    expect(ampModelOfJson({ in_shape: [null, "x"], layers: [] })).toBeNull();
  });

  it("knows a .nam without opening it, and reads a .json off disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "amp-model-"));
    expect(ampModelInfo(join(dir, "absent.nam"))).toEqual({
      kind: "nam",
      knobs: 0,
    });
    const file = join(dir, "drive.json");
    writeFileSync(file, JSON.stringify(aida(2)));
    expect(ampModelInfo(file)).toEqual({ kind: "aida-x", knobs: 1 });
    expect(ampModelInfo(join(dir, "absent.json"))).toBeNull();
    writeFileSync(join(dir, "bad.json"), "{");
    expect(ampModelInfo(join(dir, "bad.json"))).toBeNull();
  });
});
