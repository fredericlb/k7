// What the module builder can bind on a mixer strip.
//
// The bind list is the only place a widget can pick a name up from, so a module whose params are invisible here
// cannot be given a panel at all. Three sources feed it and two of them are LEARNED — the base's own `params:`
// and whatever extends it — which is why the mixer had an empty list the day it shipped: l8 defines the
// plugin, and nothing in any project had authored a param on it yet.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS, builtinParamsFor } from "./builtinParams";
import { projectHints } from "./hints";
import { MIXER_PARAMS, MIXER_PLUGIN } from "./project";
import { writeModule, writeNode, writeYaml } from "./testSupport";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-mixer-hints-"));
  writeYaml(join(dir, "project.yaml"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeFileSync(
    join(dir, "graph.yaml"),
    "modules:\n  vox: [ mixer:vox ]\n  mixer:vox: [ OUT ]\n",
    "utf8",
  );
  writeModule(dir, "io", "OUT", { io: "out" });
  writeModule(dir, "audio", "mixer", {
    plugin: { type: "internal", name: MIXER_PLUGIN },
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a built-in's params are known without a project having authored one", () => {
  it("lists every mixer param on a strip nobody has touched", () => {
    // No node file at all: the plugin is the only thing that can say what it has.
    const h = projectHints(dir);
    expect(h.paramsByBase["audio/mixer"]).toEqual([...MIXER_PARAMS].sort());
  });

  it("carries the RANGES, which no learned name ever has", () => {
    // A widget bound without a range is drawn 0..1. On a -60..+6 dB fader that is not a cosmetic problem: the
    // knob writes the wrong number into the file.
    const meta = projectHints(dir).paramMetaByBase["audio/mixer"];
    expect(meta.Volume).toEqual({ min: -60, max: 6, def: 0 });
    expect(meta.Pan).toEqual({ min: -1, max: 1, def: 0 });
    for (const band of ["Low", "Mid", "High"])
      expect(meta[band]).toEqual({ min: -18, max: 18, def: 0 });
  });

  it("keeps the C++ plugin and this table naming the same five params", () => {
    // The half that breaks silently: a rename in MixerPlugin.cpp leaves every existing binding pointing at a
    // name the plugin no longer answers to, and nothing else in the build would notice.
    //
    // Sharper now than when the table was typed out by hand: it is GENERATED from a real instance of the
    // plugin, so this compares MixerPlugin.cpp against the vocabulary the rest of the repo spells out —
    // and it fails when the generator has not been re-run after a rename, which is the thing that rots.
    expect(
      builtinParamsFor({ type: "internal", name: MIXER_PLUGIN })?.map(
        (p) => p.name,
      ),
    ).toEqual([...MIXER_PARAMS]);
  });
});

/**
 * The table is generated (`builtinParams.generated.ts`) by asking a real engine. These pin the parts a
 * regeneration must not quietly change — a plugin dropping out of the list is a module builder that goes
 * blank for it, which is the failure this whole table was added to fix.
 */
describe("the generated built-in table", () => {
  it("has 4OSC, and it is the one with a real instrument's worth of params", () => {
    // The report that started this: 4OSC registers its 68 parameters in its CONSTRUCTOR, so nothing short
    // of an instance can list them — and before the table existed the builder offered none at all.
    const p = builtinParamsFor({ type: "internal", name: "4OSC" });
    expect(p?.length).toBeGreaterThan(60);
    // The engine's own spelling, not a plausible one: `Filter Freq`, and four oscillators each with
    // their own `Tune n`. Guessing "Filter Frequency" here is what this assertion caught first.
    expect(p?.map((x) => x.name)).toContain("Filter Freq");
    expect(p?.map((x) => x.name)).toContain("Tune 4");
    // The range is the half a learned name never carries — a knob drawn 0..1 writes the wrong number.
    expect(p?.find((x) => x.name === "Tune 1")).toMatchObject({
      min: -36,
      max: 36,
    });
  });

  it("answers to the human form and the internal id alike", () => {
    // The engine's `resolveBuiltInType` matches on either, case-insensitively. This is its twin, and the
    // two disagreeing would be a module that plays perfectly with an empty parameter list.
    const byId = builtinParamsFor({ type: "internal", name: "4osc" });
    const byName = builtinParamsFor({ type: "internal", name: "4OSC" });
    expect(byId).toBe(byName);
    expect(builtinParamsFor({ type: "internal", name: "studio_mixer" })).toBe(
      builtinParamsFor({ type: "internal", name: "Mixer" }),
    );
  });

  it("says nothing about an external plugin, which reports its own", () => {
    expect(builtinParamsFor({ type: "vst3", name: "Serum" })).toBeUndefined();
    expect(builtinParamsFor(undefined)).toBeUndefined();
    expect(
      builtinParamsFor({ type: "internal", name: "Nope" }),
    ).toBeUndefined();
  });

  it("keeps a parameterless built-in as an EMPTY list, not a missing one", () => {
    // Patch Bay's state is its routing, not parameters. "It has none" and "we never asked" are different
    // answers, and only the first lets a panel say so instead of looking unfinished.
    expect(builtinParamsFor({ type: "internal", name: "Patch Bay" })).toEqual(
      [],
    );
  });

  it("carries every plugin the engine can create", () => {
    // A count rather than a list: the point is that regenerating after adding a built-in is not optional,
    // and a table that lost entries is the silent version of this feature not working.
    expect(Object.keys(BUILTIN_PLUGINS).length).toBeGreaterThanOrEqual(26);
    for (const [type, info] of Object.entries(BUILTIN_PLUGINS)) {
      expect(info.name, type).toBeTruthy();
      expect(["instrument", "audioEffect", "midiEffect"]).toContain(info.role);
      for (const p of info.params) {
        expect(p.name, `${type}/${p.name}`).toBeTruthy();
        // A range the wrong way round draws a knob that cannot move. Equal is fine — a switch.
        expect(p.max, `${type}/${p.name}`).toBeGreaterThanOrEqual(p.min);
      }
    }
  });
});

describe("a node counts as much as an extender", () => {
  it("picks up a param authored only on one strip", () => {
    // A node IS an extender now — `vox` extends `audio/mixer` and gives it its own values.
    // Leaving nodes out made every param on every strip of a real song invisible to the builder.
    writeNode(dir, "vox", {
      extends: "@project/audio/mixer",
      params: { Drive: 3 },
    });
    expect(projectHints(dir).paramsByBase["audio/mixer"]).toContain("Drive");
  });
});
