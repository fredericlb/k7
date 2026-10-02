// The mastering surface's vocabulary, and the one thing about it that can go wrong quietly: the
// scaffold's copy of it, in @studio/song, drifting from the list this app actually draws.
//
// `project surface new mastering` writes the skeleton from `SURFACE_MAPPING_SKELETON`; the strip
// resolves the file against `MASTER_CONTROLS`. A control added here and not there is a knob no
// scaffolded project offers; one added there and not here is a line the strip reports as "not a
// control of this surface" on a file the tool itself wrote. Neither shows up in a type error —
// `@studio/song` accepts any key, deliberately (packages/song/docs/viewBindings.md).

import { SURFACE_MAPPING_SKELETON } from "@studio/song-schema/yaml/surfaceSchema";
import { describe, expect, it } from "vitest";
import {
  MASTER_CONTROLS,
  MASTER_PARTS,
  mappedModules,
  masterControl,
  unmappedControls,
} from "./controls";

describe("the mastering surface's controls", () => {
  const skeleton = SURFACE_MAPPING_SKELETON.mastering;

  it("is the list the scaffold writes, in the same order", () => {
    // The order is the signal's, so a scaffolded file read top to bottom reads as the chain inside the node.
    expect(skeleton.map(([id]) => id)).toEqual(
      MASTER_CONTROLS.map((c) => c.id),
    );
  });

  it("says the same thing about each one", () => {
    // The note is what somebody reads when they fill the line in; two copies that disagree send them looking for two modules.
    expect(skeleton.map(([, wants]) => wants)).toEqual(
      MASTER_CONTROLS.map((c) => c.wants),
    );
  });

  it("puts every control in one of the three parts", () => {
    // The parts ARE the node: a control in none of them would resolve, move a param, and be drawn nowhere.
    for (const c of MASTER_CONTROLS) expect(MASTER_PARTS).toContain(c.part);
    for (const part of MASTER_PARTS)
      expect(MASTER_CONTROLS.some((c) => c.part === part)).toBe(true);
  });

  it("keeps every home inside its own range", () => {
    // `home` is what a knob draws before the engine has said anything; outside the range it would draw at an end, then jump.
    for (const c of MASTER_CONTROLS) {
      expect(c.range[0]).toBeLessThan(c.range[1]);
      expect(c.home).toBeGreaterThanOrEqual(c.range[0]);
      expect(c.home).toBeLessThanOrEqual(c.range[1]);
    }
  });

  it("requires the ten — this surface is ONE node — and offers the three optional stages", () => {
    // There is no smaller mastering strip: a missing line is the same strip with a dead knob, asserted through the GATE.
    const required = MASTER_CONTROLS.filter((c) => !c.optional);
    expect(required).toHaveLength(10);
    expect(unmappedControls({})).toEqual(required);
    // …and a surface written before the word length existed still draws: its line is OFFERED, not required.
    expect(MASTER_CONTROLS.filter((c) => c.optional).map((c) => c.id)).toEqual([
      "comp.lowCut",
      "limiter.hfLimit",
      "limiter.output",
    ]);
  });

  it("counts an absent line and a null one as the same gap", () => {
    // A scaffolded file is made of `null`s, so a gate that only looked for absence would draw ten dead knobs.
    const wired = Object.fromEntries(
      MASTER_CONTROLS.map((c) => [c.id, { module: "qm", param: "x" }]),
    );
    expect(unmappedControls(wired)).toHaveLength(0);
    expect(unmappedControls({ ...wired, "comp.low": null })).toEqual([
      masterControl("comp.low"),
    ]);
    const { "spread.width": _dropped, ...short } = wired;
    expect(unmappedControls(short).map((c) => c.id)).toEqual(["spread.width"]);
    expect(unmappedControls(undefined)).toHaveLength(10);
    const {
      "comp.lowCut": _cut,
      "limiter.hfLimit": _hf,
      "limiter.output": _optional,
      ...old
    } = wired;
    expect(unmappedControls(old)).toHaveLength(0);
  });

  it("reads one module out of ten lines naming it", () => {
    // The shape the strip is drawn for, and why `mappedModules` deduplicates: more than one is legal and worth SAYING.
    const one = Object.fromEntries(
      MASTER_CONTROLS.map((c) => [c.id, { module: "master_qm_1", param: "x" }]),
    );
    expect(mappedModules(one)).toEqual(["master_qm_1"]);
    expect(
      mappedModules({
        ...one,
        "limiter.drive": { module: "other", param: "x" },
      }),
    ).toEqual(["master_qm_1", "other"]);
    expect(mappedModules(undefined)).toEqual([]);
  });
});
