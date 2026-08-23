// What the module builder can bind on a mixer strip.
//
// The bind list is the only place a widget can pick a name up from, so a module whose params are invisible here
// cannot be given a panel at all. Three sources feed it and two of them are LEARNED — the base's own `params:`
// and whatever extends it — which is why the mixer had an empty list the day it shipped: st0 defines the
// plugin, and nothing in any project had authored a param on it yet.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILTIN_PLUGINS,
  builtinParamsFor,
  builtinPluginForRef,
} from "@studio/song-schema/builtinParams";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    // A widget bound without a range is drawn 0..1, so a -60..+6 dB fader writes the wrong number.
    const meta = projectHints(dir).paramMetaByBase["audio/mixer"];
    expect(meta.Volume).toEqual({ min: -60, max: 6, def: 0 });
    expect(meta.Pan).toEqual({ min: -1, max: 1, def: 0 });
    for (const band of ["Low", "Mid", "High"])
      expect(meta[band]).toEqual({ min: -18, max: 18, def: 0 });
  });

  it("keeps the C++ plugin and this table naming the same five params", () => {
    // A rename in MixerPlugin.cpp breaks every binding silently, and nothing else in the build sees it.
    expect(
      builtinParamsFor({ type: "internal", name: MIXER_PLUGIN })?.map(
        (p) => p.name,
      ),
    ).toEqual([...MIXER_PARAMS]);
  });
});

/** The generated table's parts a regeneration must not change: a plugin dropping out goes blank. */
describe("the generated built-in table", () => {
  it("has 4OSC, and it is the one with a real instrument's worth of params", () => {
    // 4OSC registers its 68 parameters in its CONSTRUCTOR, so only an instance can list them.
    const p = builtinParamsFor({ type: "internal", name: "4OSC" });
    expect(p?.length).toBeGreaterThan(60);
    // The engine's own spelling: guessing "Filter Frequency" is what this assertion caught first.
    expect(p?.map((x) => x.name)).toContain("Filter Freq");
    expect(p?.map((x) => x.name)).toContain("Tune 4");
    // The range is the half a learned name never carries — a knob drawn 0..1 writes the wrong number.
    expect(p?.find((x) => x.name === "Tune 1")).toMatchObject({
      min: -36,
      max: 36,
    });
  });

  /** A wave shape is ValueTree state, so the state table supplements rather than falls back. */
  it("carries a control that is NOT an automatable parameter, beside ones that are", () => {
    const p = builtinParamsFor({ type: "internal", name: "4OSC" });
    const names = p?.map((x) => x.name) ?? [];
    for (const n of [1, 2, 3, 4]) expect(names).toContain(`Wave Shape ${n}`);
    // …and the automatable ones are still all there. Appended, never shadowing.
    expect(names).toContain("Tune 1");
    expect(names.length).toBeGreaterThan(80);
  });

  it("gives a wave shape its SETTINGS, so it draws as a list and not a sweep", () => {
    // The VALUE rides with each label because the mapping is the plugin's, not index/(n-1).
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
    // Oscillator one starts on a sine and the other three at none, so a fresh 4OSC is one sine.
    expect(shape?.def).toBe(1);
    expect(
      builtinParamsFor({ type: "internal", name: "4OSC" })?.find(
        (x) => x.name === "Wave Shape 2",
      )?.def,
    ).toBe(0);
  });

  it("says 4OSC is POLYPHONIC, in the vocabulary the plugin uses for it", () => {
    // `isMono/isLegato/isPoly` are three predicates in FourOscPlugin.h, not an enum, and poly is the default.
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
    // Read off `updateFilter`'s own calls, where 0 is the branch that skips the filter entirely.
    const p = builtinParamsFor({ type: "internal", name: "4OSC" });
    expect(
      p?.find((x) => x.name === "Filter Type")?.states?.map((s) => s.label),
    ).toEqual(["Off", "Low-pass", "High-pass", "Band-pass", "Notch"]);
    // `filterSlopeValue == 24` cascades the second pair, so the values are dB/octave, not an index.
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

  /** A library module declares no plugin, only `extends:`, so reading `plugin:` alone found nothing. */
  it("resolves the `@engine/<slug>` ref a library module is written as", () => {
    expect(builtinPluginForRef("@engine/4osc")?.name).toBe("4OSC");
    // The slug is `slugifyPluginName(displayName)`, which a bare lower-casing would have missed.
    expect(builtinPluginForRef("@engine/neural-amp-modeler")?.name).toBe(
      "Neural Amp Modeler",
    );
    expect(builtinPluginForRef("@engine/mixer")?.name).toBe("Mixer");
  });

  it("resolves ONLY the engine namespace — every other ref names a file", () => {
    // A `@st0/…` or project-local ref has to be read; this seam is for when there is no file.
    expect(builtinPluginForRef("@st0/instruments/4osc")).toBeUndefined();
    expect(builtinPluginForRef("instruments/fourosc")).toBeUndefined();
    expect(builtinPluginForRef("@engine/nope")).toBeUndefined();
    expect(builtinPluginForRef(null)).toBeUndefined();
  });

  it("answers to the human form and the internal id alike", () => {
    // The twin of the engine's `resolveBuiltInType`: disagreeing means a module with no params.
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
    // "It has none" and "we never asked" are different answers, and only the first can be drawn.
    expect(builtinParamsFor({ type: "internal", name: "Patch Bay" })).toEqual(
      [],
    );
  });

  /** The 186 AirWindows plugins sit beside `builtInPlugins()`, so a dump of it alone missed them all. */
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
    // A count rather than a list: a table that lost entries is this feature failing silently.
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
    // A node IS an extender, and leaving nodes out hid every param of every strip in a real song.
    writeNode(dir, "vox", {
      extends: "@project/audio/mixer",
      params: { Drive: 3 },
    });
    expect(projectHints(dir).paramsByBase["audio/mixer"]).toContain("Drive");
  });
});
