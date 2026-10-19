// Binding a curve to a param — the file half of a cable dropped on a knob. Surgical, keyed by
// param, and reversible: those three are what a gesture needs from a writer it cannot inspect.

import { K7Document, parse } from "@studio/k7x/document";
import { setModuleAutomation } from "@studio/song-schema/yaml/moduleFile";
import { describe, expect, it } from "vitest";

const MOD = `// a synth
plugin({ type: "internal", name: "4OSC" })
params({ Level: -6 })
`;

/** The file after one binding, as the app writes it: the writer run on the whole document. */
function bind(
  text: string,
  param: string,
  curve: string | null,
  trigger?: string,
): string {
  const doc = new K7Document(text);
  setModuleAutomation(doc.at([]), param, curve, trigger);
  return doc.toString();
}

const bindings = (text: string) =>
  (parse(text).automations ?? []) as Record<string, string>[];

describe("binding a curve to a param", () => {
  it("adds the binding and leaves the rest of the file alone", () => {
    const out = bind(MOD, "Filter Freq", "sweep");
    expect(out).toContain("// a synth"); // the comment survives
    expect(out).toContain("params({ Level: -6 })");
    expect(bindings(out)).toEqual([{ param: "Filter Freq", curve: "sweep" }]);
  });

  it("REPLACES the curve on a param already bound, rather than stacking two", () => {
    // One automation per (plugin, param) is baked, so a second would silently win.
    const once = bind(MOD, "Filter Freq", "sweep");
    const twice = bind(once, "Filter Freq", "wobble");
    expect(bindings(twice)).toEqual([
      { param: "Filter Freq", curve: "wobble" },
    ]);
  });

  it("keeps a binding on ANOTHER param", () => {
    let out = bind(MOD, "Filter Freq", "sweep");
    out = bind(out, "Level", "wobble");
    expect(bindings(out)).toEqual([
      { param: "Filter Freq", curve: "sweep" },
      { param: "Level", curve: "wobble" },
    ]);
  });

  it("writes a trigger only when there IS one", () => {
    // Absent means the module being automated, and writing it out goes stale when it moves.
    expect(bind(MOD, "P", "env1")).not.toContain("trigger");
    expect(bindings(bind(MOD, "P", "env1", "drums"))).toEqual([
      { param: "P", curve: "env1", trigger: "drums" },
    ]);
  });

  it("takes a binding off, and the empty list with it", () => {
    // `automations([])` would say something was authored and then emptied, which is not the case.
    const bound = bind(MOD, "Filter Freq", "sweep");
    const off = bind(bound, "Filter Freq", null);
    expect(off).not.toContain("sweep");
    expect(off).not.toContain("automations");
    expect(off).toContain("params({ Level: -6 })");
  });

  it("leaves the others when one of several is taken off", () => {
    let out = bind(MOD, "A", "c1");
    out = bind(out, "B", "c2");
    out = bind(out, "A", null);
    expect(bindings(out)).toEqual([{ param: "B", curve: "c2" }]);
  });

  it("unbinding what was never bound changes nothing", () => {
    expect(bind(MOD, "nope", null)).toBe(MOD);
  });
});
