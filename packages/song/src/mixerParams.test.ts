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
import {
  BUILTIN_PLUGINS,
  builtinParamsFor,
  builtinPluginForRef,
} from "./builtinParams";
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

  /**
   * A wave shape is not an automatable parameter — it is a `CachedValue<int>` on the ValueTree, like
   * Chorus's whole control set. The state table used to be a FALLBACK, reached only when a plugin
   * registered nothing at all, so 4OSC's 68 automatable params hid it: a synth whose oscillators could
   * be tuned and not chosen. It is a supplement now.
   */
  it("carries a control that is NOT an automatable parameter, beside ones that are", () => {
    const p = builtinParamsFor({ type: "internal", name: "4OSC" });
    const names = p?.map((x) => x.name) ?? [];
    for (const n of [1, 2, 3, 4]) expect(names).toContain(`Wave Shape ${n}`);
    // …and the automatable ones are still all there. Appended, never shadowing.
    expect(names).toContain("Tune 1");
    expect(names.length).toBeGreaterThan(80);
  });

  it("gives a wave shape its SETTINGS, so it draws as a list and not a sweep", () => {
    // Six shapes in an order nobody would guess from a 0..6 knob, and `None` is a real one — it is
    // how an oscillator is switched off. The VALUE rides with each label because the mapping is the
    // plugin's, not index/(n-1).
    const shape = builtinParamsFor({ type: "internal", name: "4OSC" })?.find(
      (x) => x.name === "Wave Shape 1",
    );
    expect(shape?.states?.map((s) => s.label)).toEqual([
      "None",
      "Sine",
      "Triangle",
      "Saw up",
      "Saw down",
      "Square",
      "Random",
    ]);
    expect(shape?.states?.find((s) => s.label === "Sine")?.value).toBe(1);
    // Oscillator one starts on a sine and the other three at none — which is what makes a fresh
    // 4OSC one sine rather than four stacked.
    expect(shape?.def).toBe(1);
    expect(
      builtinParamsFor({ type: "internal", name: "4OSC" })?.find(
        (x) => x.name === "Wave Shape 2",
      )?.def,
    ).toBe(0);
  });

  it("says 4OSC is POLYPHONIC, in the vocabulary the plugin uses for it", () => {
    // `isMono/isLegato/isPoly` are three predicates in FourOscPlugin.h, not an enum — which is why
    // "is there an enum" was the wrong question to stop at. Poly is the default, and `Voices`
    // means something only there: the other two modes reduce the pool to one whatever it says.
    const p = builtinParamsFor({ type: "internal", name: "4OSC" });
    const mode = p?.find((x) => x.name === "Voice Mode");
    expect(mode?.states).toEqual([
      { label: "Mono", value: 0 },
      { label: "Legato", value: 1 },
      { label: "Poly", value: 2 },
    ]);
    expect(mode?.def).toBe(2);
    expect(p?.find((x) => x.name === "Voices")).toMatchObject({
      min: 1,
      max: 32,
      def: 32,
    });
  });

  it("names the filter's types after the calls they select", () => {
    // `makeLowPass`, `makeHighPass`, `makeBandPass`, `makeNotchFilter` in `updateFilter`, and 0 is
    // the branch that skips the filter entirely. Read off the code that consumes the value, which
    // is how this table's RANGES have always been derived.
    const p = builtinParamsFor({ type: "internal", name: "4OSC" });
    expect(
      p?.find((x) => x.name === "Filter Type")?.states?.map((s) => s.label),
    ).toEqual(["Off", "Low-pass", "High-pass", "Band-pass", "Notch"]);
    // Two poles or four — `filterSlopeValue == 24` is the test that cascades the second pair, so
    // the values are the dB/octave themselves and not an index.
    expect(p?.find((x) => x.name === "Filter Slope")?.states).toEqual([
      { label: "12 dB/oct", value: 12 },
      { label: "24 dB/oct", value: 24 },
    ]);
  });

  it("still reports the plugins that register NOTHING but state", () => {
    // The case the table was built for. A supplement must not have cost them anything.
    expect(
      builtinParamsFor({ type: "internal", name: "chorus" })?.map(
        (x) => x.name,
      ),
    ).toEqual(["Depth", "Speed", "Width", "Mix"]);
    expect(
      builtinParamsFor({ type: "internal", name: "phaser" })?.map(
        (x) => x.name,
      ),
    ).toEqual(["Depth", "Rate", "Feedback"]);
  });

  /**
   * The file the report was actually about, verbatim from
   * `_libraries/modules/instruments/4osc/module.yaml`. It declares no plugin — the whole file is
   * one `extends:` — so reading only a `plugin:` block found nothing and the list stayed empty
   * even after this table existed.
   */
  it("resolves the `@engine/<slug>` ref a library module is written as", () => {
    expect(builtinPluginForRef("@engine/4osc")?.name).toBe("4OSC");
    // The slug is `slugifyPluginName(displayName)`, so a multi-word plugin lands too — which is
    // the case a bare lower-casing would have missed.
    expect(builtinPluginForRef("@engine/neural-amp-modeler")?.name).toBe(
      "Neural Amp Modeler",
    );
    expect(builtinPluginForRef("@engine/mixer")?.name).toBe("Mixer");
  });

  it("resolves ONLY the engine namespace — every other ref names a file", () => {
    // A `@st0/…` or a project-local ref has to be read and resolved; this seam exists for the
    // case where there is nothing to read.
    expect(builtinPluginForRef("@st0/instruments/4osc")).toBeUndefined();
    expect(builtinPluginForRef("instruments/fourosc")).toBeUndefined();
    expect(builtinPluginForRef("@engine/nope")).toBeUndefined();
    expect(builtinPluginForRef(null)).toBeUndefined();
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

  /**
   * The AirWindows set — 186 of the plugins a project can name, and they were all missing.
   *
   * They are registered from their own X-macro, in a list beside the built-ins rather than in
   * it, so a dump that walked only `builtInPlugins()` produced a table where seven eighths of
   * the engine's catalogue had no parameters. The symptom was an empty panel on
   * `@engine/chorus-ensemble`, which reads as "the generator does not work" rather than as
   * "that plugin was never asked".
   */
  it("carries the AirWindows effects too, not just the Tracktion built-ins", () => {
    expect(builtinPluginForRef("@engine/chorus-ensemble")?.name).toBe(
      "Chorus Ensemble",
    );
    expect(
      builtinParamsFor({ type: "internal", name: "Chorus Ensemble" })?.map(
        (p) => p.name,
      ),
    ).toEqual(["Speed", "Range", "Dry Level", "Wet Level"]);
    // A count rather than a list: what matters is that the second list is in there at all.
    expect(Object.keys(BUILTIN_PLUGINS).length).toBeGreaterThan(150);
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
