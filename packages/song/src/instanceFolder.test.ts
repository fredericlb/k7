import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModuleInstance, loadModuleRefs, loadModules } from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import { writeInstance } from "./testSupport";

// A project's uses of modules, in the flat `instances/` folder.
//
// This is how a project uses a module the ENGINE provides, and it is why the folder can be
// flat at all: `module populate` used to file 254 wrappers into the shared library so a
// project could `extends` one, and each wrapper carried two facts the engine already knew.
// The project writes only what is its own — which plugin, and how it is set.
//
// What used to make this work was the type FOLDER: an instance sat at
// `modules/<type>/<name>/<instance>.yaml` and read `kind`, `inputs` and `category` off the
// path. A flat folder has no such path, so those arrive from what the instance `extends` —
// and an instance that extends nothing has only what it states itself.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-instfold-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the instances folder", () => {
  it("loads each file as one use, keyed by its filename", () => {
    writeInstance(dir, "lead", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { Input: -5 },
    });
    writeInstance(dir, "rhythm", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { Input: 2 },
    });
    const m = loadModules(dir);
    // The FILE names it — no module folder is involved, so nothing else can.
    expect(Object.keys(m).sort()).toEqual(["lead", "rhythm"]);
    expect(m.lead.params).toEqual({ Input: -5 });
    expect(m.rhythm.params).toEqual({ Input: 2 });
  });

  it("carries the identity of the plugin, so the project stands on its own", () => {
    // The scan cache is machine-local. If the instance did not say WHICH plugin, a
    // project opened on a machine that has never scanned would not know what to load.
    writeInstance(dir, "slap", { plugin: { type: "internal", name: "ADT" } });
    expect(loadModules(dir).slap.plugin).toEqual({
      type: "internal",
      name: "ADT",
    });
  });

  it("takes kind, inputs and category from what it EXTENDS", () => {
    // The replacement for the type folder, and the reason an instance no longer has to be
    // filed under the module it uses.
    mkdirSync(join(dir, "modules", "instruments", "mini"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "instruments", "mini", "module.yaml"),
      "plugin:\n  type: vst3\n  name: Mini V3\n",
      "utf8",
    );
    writeInstance(dir, "solo", { extends: "@project/instruments/mini" });
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved.solo).toMatchObject({
      kind: "plugin",
      category: "instruments",
      inputs: [{ name: "midi", type: "midi" }],
    });
    // …and the plugin comes down the same way.
    expect(resolved.solo.plugin).toEqual({ type: "vst3", name: "Mini V3" });
  });

  it("resolves an explicit library `extends` — that is how a shared module is used", () => {
    writeInstance(dir, "gtr", { extends: "@library/audio/filter/auto-wah" });
    expect(loadModules(dir).gtr.extends).toBe("@library/audio/filter/auto-wah");
  });

  it("ignores a folder that holds nothing", () => {
    mkdirSync(join(dir, "instances"), { recursive: true });
    expect(loadModules(dir)).toEqual({});
  });

  it("no longer reads an instance filed beside a module.yaml", () => {
    // The old layout, written by hand. It is not a second way of saying the same thing —
    // it is simply not read, so a project carrying one is silently short a step until it
    // moves. That is the clean cut this change made deliberately.
    mkdirSync(join(dir, "modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "audio", "amp", "module.yaml"),
      "plugin:\n  type: internal\n  name: ADT\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "modules", "audio", "amp", "lead.yaml"),
      "params:\n  Input: -5\n",
      "utf8",
    );
    const m = loadModules(dir);
    expect(Object.keys(m)).toEqual(["amp"]); // the module, and only the module
    expect(m["amp:lead"]).toBeUndefined();
    expect(m.lead).toBeUndefined();
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

  it("writes the plugin into the instance, with no module to inherit it from", () => {
    const rel = createModuleInstance(dir, "audio", "adt", "slap", CATALOGUE);
    expect(rel).toBe("instances/slap.yaml");
    const m = loadModules(dir);
    // The identity lands in the FILE. The scan is a discovery aid, not the project's
    // memory of what it uses — a machine that has never scanned still opens this song.
    expect(m.slap.plugin).toEqual({ type: "internal", name: "ADT" });
    expect(m.adt).toBeUndefined(); // and no module was invented on the way
  });

  it("refuses a name neither the project nor the engine has", () => {
    expect(() =>
      createModuleInstance(dir, "audio", "no-such-plugin", "x", CATALOGUE),
    ).toThrow(/neither in this project nor one the engine offers/);
  });
});
