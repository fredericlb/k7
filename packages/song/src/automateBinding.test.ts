// Binding a curve to a param — the file half of a cable dropped on a knob. Surgical, keyed by
// param, and reversible: those three are what a gesture needs from a writer it cannot inspect.

import { setModuleAutomation } from "@studio/song-schema/yaml/moduleFile";
import { describe, expect, it } from "vitest";

const MOD = `# a synth
plugin:
  type: internal
  name: 4OSC
params:
  Level: -6
`;

describe("binding a curve to a param", () => {
  it("adds the binding and leaves the rest of the file alone", () => {
    const out = setModuleAutomation(MOD, "Filter Freq", "sweep");
    expect(out).toContain("# a synth"); // the comment survives
    expect(out).toContain("Level: -6");
    expect(out).toMatch(
      /automations:[\s\S]*param: Filter Freq[\s\S]*curve: sweep/,
    );
  });

  it("REPLACES the curve on a param already bound, rather than stacking two", () => {
    // One knob, one lane: the compiler bakes one automation per (plugin, param), so a second
    // would silently win. Better that the file says what the graph shows.
    const once = setModuleAutomation(MOD, "Filter Freq", "sweep");
    const twice = setModuleAutomation(once, "Filter Freq", "wobble");
    expect(twice).toContain("wobble");
    expect(twice).not.toContain("sweep");
    expect(twice.match(/param: Filter Freq/g)).toHaveLength(1);
  });

  it("keeps a binding on ANOTHER param", () => {
    let out = setModuleAutomation(MOD, "Filter Freq", "sweep");
    out = setModuleAutomation(out, "Level", "wobble");
    expect(out).toContain("sweep");
    expect(out).toContain("wobble");
    expect(out.match(/param:/g)).toHaveLength(2);
  });

  it("writes a trigger only when there IS one", () => {
    // Absent means the module being automated, which is what the compiler assumes — writing it
    // out would be noise that goes stale the day the binding moves.
    expect(setModuleAutomation(MOD, "P", "env1")).not.toContain("trigger");
    expect(setModuleAutomation(MOD, "P", "env1", "drums")).toContain(
      "trigger: drums",
    );
  });

  it("takes a binding off, and the empty list with it", () => {
    // `automations: []` would say something was authored and then emptied. Unbinding the last
    // one means the module has none, which is what no key at all says.
    const bound = setModuleAutomation(MOD, "Filter Freq", "sweep");
    const off = setModuleAutomation(bound, "Filter Freq", null);
    expect(off).not.toContain("sweep");
    expect(off).not.toContain("automations");
    expect(off).toContain("Level: -6");
  });

  it("leaves the others when one of several is taken off", () => {
    let out = setModuleAutomation(MOD, "A", "c1");
    out = setModuleAutomation(out, "B", "c2");
    out = setModuleAutomation(out, "A", null);
    expect(out).toContain("c2");
    expect(out).not.toContain("c1");
    expect(out).toContain("automations");
  });

  it("unbinding what was never bound changes nothing", () => {
    expect(setModuleAutomation(MOD, "nope", null)).toBe(MOD);
  });
});
