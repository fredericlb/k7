// The write a released mastering control sends: the same `node param` line the chains graph commits.

import { describe, expect, it } from "vitest";
import { engineAgrees, type MasterBinding, masterParamLine } from "./bindings";
import { masterControl } from "./controls";

describe("masterParamLine", () => {
  const control = masterControl("limiter.ceiling");
  if (!control) throw new Error("limiter.ceiling is not a control");
  const binding: MasterBinding = {
    control,
    module: "master bus",
    param: "Ceiling dB",
    pluginId: "main:master bus",
  };

  it("names the module and the param quoted, so a space in either survives", () => {
    expect(masterParamLine(binding, -0.3)).toBe(
      'node param "master bus" "Ceiling dB" -0.3',
    );
  });

  it("writes the module the file names, never the engine's address", () => {
    expect(masterParamLine(binding, 0)).not.toContain("main:");
  });
});

// Five quick presses on Width outrun the engine: the echo of the first must not release the fifth.
describe("engineAgrees", () => {
  const control = masterControl("spread.width");
  if (!control) throw new Error("spread.width is not a control");
  const width: MasterBinding = {
    control,
    module: "master bus",
    param: "Width",
    pluginId: "main:master bus",
  };

  it("does not take the echo of an earlier step for the value held now", () => {
    expect(engineAgrees(width, 102, 101)).toBe(false);
    expect(engineAgrees(width, 105, 104)).toBe(false);
  });

  it("agrees once the engine reports the held value, float noise and all", () => {
    expect(engineAgrees(width, 105, 105)).toBe(true);
    expect(engineAgrees(width, 105, 104.9999)).toBe(true);
  });

  it("never agrees before the engine has said anything", () => {
    expect(engineAgrees(width, 100, undefined)).toBe(false);
  });
});
