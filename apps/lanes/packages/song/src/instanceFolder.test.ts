import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModuleInstance, loadModules } from "./loader";

// A module folder with NO `module.yaml` — how a project uses a module the engine provides.
//
// The folder names it, each file inside is one USE, and there is no local generic to write.
// That is the whole point: `module populate` used to file 254 wrappers into the shared
// library so a project could `extends` one, and each wrapper carried two facts the engine
// already knew. Now the project writes only what is its own — which plugin, and how it is
// set — and the type folder above still says what KIND of module it is.
//
// The two shapes have to coexist: a module a project wrote itself keeps its `module.yaml`
// and its instances merge under it, exactly as before.

let dir: string;
const mod = (type: string, name: string, file: string, body: string) => {
  mkdirSync(join(dir, "modules", type, name), { recursive: true });
  writeFileSync(join(dir, "modules", type, name, `${file}.yaml`), body, "utf8");
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-instfold-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a folder with no generic", () => {
  it("loads each file as a module in its own right", () => {
    mod(
      "audio",
      "neural-amp-modeler",
      "lead",
      "plugin:\n  type: internal\n  name: Neural Amp Modeler\nparams:\n  Input: -5\n",
    );
    mod(
      "audio",
      "neural-amp-modeler",
      "rhythm",
      "plugin:\n  type: internal\n  name: Neural Amp Modeler\nparams:\n  Input: 2\n",
    );
    const m = loadModules(dir);
    // Keyed as instances always were — the chain says `neural-amp-modeler:lead`.
    expect(Object.keys(m).sort()).toEqual([
      "neural-amp-modeler:lead",
      "neural-amp-modeler:rhythm",
    ]);
    // …and NOT under the bare folder name: there is no generic, so there is nothing to name.
    expect(m["neural-amp-modeler"]).toBeUndefined();
    expect(m["neural-amp-modeler:lead"].params).toEqual({ Input: -5 });
    expect(m["neural-amp-modeler:rhythm"].params).toEqual({ Input: 2 });
  });

  it("takes kind, inputs and category from the TYPE FOLDER, not from a generic", () => {
    // This is what makes the generic unnecessary. The ports a module has are decided by
    // where it is filed, and that is true whether or not anything sits beside it.
    mod(
      "instruments",
      "mini-v3",
      "lead",
      "plugin:\n  type: vst3\n  name: Mini V3\n",
    );
    mod("audio", "adt", "slap", "plugin:\n  type: internal\n  name: ADT\n");
    const m = loadModules(dir);
    expect(m["mini-v3:lead"]).toMatchObject({
      kind: "plugin",
      category: "instruments",
      inputs: [{ name: "midi", type: "midi" }],
    });
    expect(m["adt:slap"]).toMatchObject({
      category: "audio",
      inputs: [{ name: "in", type: "audio" }],
    });
  });

  it("carries the identity of the plugin, so the project stands on its own", () => {
    // The scan cache is machine-local. If the instance did not say WHICH plugin, a
    // project opened on a machine that has never scanned would not know what to load.
    mod("audio", "adt", "slap", "plugin:\n  type: internal\n  name: ADT\n");
    expect(loadModules(dir)["adt:slap"].plugin).toEqual({
      type: "internal",
      name: "ADT",
    });
  });

  it("still resolves an explicit `extends` — that is how a library module is used", () => {
    // A jsdsp source or a rack's sample map cannot be inlined into an instance, so a use
    // of one names it. The generic-less folder does not get in the way.
    mod(
      "audio",
      "auto-wah",
      "gtr",
      'extends: "@library/audio/filter/auto-wah"\n',
    );
    expect(loadModules(dir)["auto-wah:gtr"].extends).toBe(
      "@library/audio/filter/auto-wah",
    );
  });

  it("ignores a folder holding neither a generic nor an instance", () => {
    mkdirSync(join(dir, "modules", "audio", "empty"), { recursive: true });
    expect(loadModules(dir)).toEqual({});
  });
});

describe("creating one", () => {
  // A catalogue of exactly one module, injected — the machine's own scan would make this
  // pass or fail on what happens to be installed here.
  const CATALOGUE = {
    "@engine/adt": {
      plugin: { type: "internal", name: "ADT" },
      kind: "plugin" as const,
      inputs: [{ name: "in", type: "audio" as const }],
      category: "audio",
      file: "adt",
    },
  };

  it("writes the plugin into the instance, with no generic to inherit it from", () => {
    const rel = createModuleInstance(dir, "audio", "adt", "slap", CATALOGUE);
    expect(rel).toBe("modules/audio/adt/slap.yaml");
    const m = loadModules(dir);
    // The identity lands in the FILE. The scan is a discovery aid, not the project's
    // memory of what it uses — a machine that has never scanned still opens this song.
    expect(m["adt:slap"].plugin).toEqual({ type: "internal", name: "ADT" });
    expect(m.adt).toBeUndefined(); // and no generic was invented on the way
  });

  it("refuses a name neither the project nor the engine has", () => {
    expect(() =>
      createModuleInstance(dir, "audio", "no-such-plugin", "x", CATALOGUE),
    ).toThrow(/neither in this project nor one the engine offers/);
  });
});

describe("a folder WITH a generic still behaves as it did", () => {
  it("keeps the generic and merges each instance under it", () => {
    mod(
      "audio",
      "reverb",
      "module",
      "plugin:\n  type: vst3\n  name: Reverb\nparams:\n  Mix: 0.2\n  Size: 9\n",
    );
    mod("audio", "reverb", "hall", "params:\n  Mix: 0.9\n");
    const m = loadModules(dir);
    expect(m.reverb.params).toEqual({ Mix: 0.2, Size: 9 });
    // Per key: the instance overrides Mix and inherits Size.
    expect(m["reverb:hall"].params).toEqual({ Mix: 0.9, Size: 9 });
    expect(m["reverb:hall"].plugin).toEqual({ type: "vst3", name: "Reverb" });
  });
});
