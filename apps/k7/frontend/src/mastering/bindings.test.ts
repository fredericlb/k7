// The write a released mastering control sends: the same `node param` line the chains graph commits.

import { describe, expect, it } from "vitest";
import { type MasterBinding, masterParamLine } from "./bindings";
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
