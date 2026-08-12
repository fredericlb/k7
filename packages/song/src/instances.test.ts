import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createModuleInstance,
  loadModuleRefs,
  loadModules,
  splitModuleKey,
} from "@studio/song/loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectHints } from "./hints";
import { resolveModuleMap } from "./moduleResolve";
import { compileNodeProject } from "./nodeProject";
import { writeInstance, writeModule } from "./testSupport";

// Module INSTANCES: one USE of a module, as `instances/<name>.yaml` — a FLAT folder at the
// project root, where the file names the instance and chains name it by that alone. Which
// module it uses is `extends` and nothing else, so an instance no longer mirrors the folders
// of the thing it uses. These check the whole path — the loader, the compiler, the hints the
// editor completes from, and the overlay that pins a chain step to the real set.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);

describe("splitModuleKey", () => {
  it("splits a ref on its first separator", () => {
    expect(splitModuleKey("synth")).toEqual({ module: "synth" });
    expect(splitModuleKey("synth:lead")).toEqual({
      module: "synth",
      instance: "lead",
    });
  });
});

describe("module instances", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-inst-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads instances/<name>.yaml keyed by the BARE name", () => {
    const modules = loadModules(dir);
    expect(Object.keys(modules)).toContain("synth"); // the module is still there
    const lead = modules.lead;
    expect(lead).toBeTruthy();
    expect(lead.instance).toBe("lead");
    expect(lead.home).toBe("instances"); // where its own files live
    // No "synth:lead" anywhere: the module it uses is not part of its name any more.
    expect(modules["synth:lead"]).toBeUndefined();
    // Which module it uses is what it EXTENDS, and that is the only place it is written.
    expect(lead.extends).toBe("@project/instruments/synth");
    expect(lead.params?.["Filter Freq"]).toBe(90);
  });

  it("takes its type from what it extends, having no type folder of its own", () => {
    // The whole reason a flat folder can work. `kind`, `inputs` and `category` used to come
    // from `modules/<type>/…`; an instance has no such path, so they arrive through extends.
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved.lead.category).toBe("instruments");
    expect(resolved.lead.kind).toBe("plugin");
    expect(resolved.lead.inputs).toEqual([{ name: "midi", type: "midi" }]);
  });

  it("lets an instance override the module while leaving it untouched", () => {
    const modules = loadModules(dir);
    const refs = loadModuleRefs(dir, {});
    const resolved = resolveModuleMap(modules, refs);
    // pad.yaml overrides two params and empties the inherited automation list.
    expect(resolved.pad.params).toEqual({ "Filter Freq": 40, Level: -12 });
    expect(resolved.pad.automations).toEqual([]);
    // Its sibling and the module are untouched — the merge only ever runs downhill.
    expect(resolved.lead.params?.["Filter Freq"]).toBe(90);
    expect((resolved.lead.automations as unknown[]).length).toBe(2);
    expect(modules.synth.params).toBeUndefined();
    expect((modules.synth.automations as unknown[]).length).toBe(2);
  });

  it("keeps instances out of the `extends` vocabulary, which names MODULES", () => {
    // No engine catalogue here: this asks what the project's FILES define, and the
    // machine's scanned plugins would drown a vocabulary of two.
    const refs = loadModuleRefs(dir, {});
    // An instance is a USE. Offering one as an `extends` target would invite a second use
    // to inherit the first one's overrides, which is not what "extends the synth" means.
    expect(Object.keys(refs)).not.toContain("lead");
    expect(refs["instruments/synth"].instance).toBeUndefined();
    expect(refs["instruments/synth"].params?.["Filter Freq"]).toBeUndefined();
    const base = projectHints(dir).baseModules;
    expect(base).toEqual(
      expect.arrayContaining(["instruments/fourosc", "instruments/synth"]),
    );
    expect(base).not.toContain("lead");
  });

  it("compiles two instances of one module into two independent plugins", () => {
    // The demo's chains name "lead" and "pad" — one module, two voices.
    const doc = compileNodeProject(dir);
    const lead = doc.tracks
      .find((t) => t.id === "melody")
      // "melody", not "lead": a chain is called after its track now — the `as:` alias
      // that renamed it went with the list format.
      ?.plugins.find((p) => p.id === "melody:lead");
    const pad = doc.tracks
      .find((t) => t.id === "pad")
      ?.plugins.find((p) => p.id === "pad:pad");
    expect(lead).toBeTruthy();
    expect(pad).toBeTruthy();
    // The plugin is inherited through instruments/synth -> instruments/fourosc by both.
    expect(lead?.type).toBe("4osc");
    expect(pad?.type).toBe("4osc");
    expect(lead?.params?.["Filter Freq"]).toBe(90);
    expect(pad?.params?.["Filter Freq"]).toBe(40);
    // Each saves its own opaque state BESIDE ITS OWN FILE, so a UI edit on one leaves the
    // other — and the module they share — alone.
    expect(lead?.presetSave.replace(/\\/g, "/")).toMatch(
      /instances\/lead\.vstpreset$/,
    );
    expect(pad?.presetSave.replace(/\\/g, "/")).toMatch(
      /instances\/pad\.vstpreset$/,
    );
  });

  it("offers instances to the editor, each linked to its own file", () => {
    const h = projectHints(dir);
    expect(h.modules).toContain("synth"); // the module
    expect(h.modules).toContain("lead"); // and the use of it
    expect(h.paths["module:lead"]).toBe("instances/lead.yaml");
    expect(h.paths["module:synth"]).toBe(
      "modules/instruments/synth/module.yaml",
    );
  });

  it("scaffolds a new instance into instances/, naming what it uses", () => {
    const rel = createModuleInstance(dir, "instruments", "synth", "solo");
    expect(rel).toBe("instances/solo.yaml");
    // The relationship is written down exactly once, and this is it.
    expect(readFileSync(join(dir, rel), "utf8")).toMatch(
      /^extends: "@project\/instruments\/synth"$/m,
    );
    const solo = loadModules(dir).solo;
    expect(solo.instance).toBe("solo");
    expect(projectHints(dir).modules).toContain("solo");
    // …and it resolves through that ref to the plugin two levels up.
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved.solo.plugin).toMatchObject({ name: "4osc" });
  });

  it("refuses a name already taken, project-wide", () => {
    expect(() =>
      createModuleInstance(dir, "instruments", "synth", "lead"),
    ).toThrow(/already names a module or instance/);
    // The name is one flat key now, so a MODULE's name is taken too — a chain saying
    // "synth" must not be able to mean two things.
    expect(() =>
      createModuleInstance(dir, "instruments", "synth", "synth"),
    ).toThrow(/already names a module or instance/);
    expect(() => createModuleInstance(dir, "instruments", "nope", "x")).toThrow(
      /neither in this project nor one the engine offers/,
    );
  });

  it("refuses to shadow a module with an instance of the same name", () => {
    // Written by hand rather than through createModuleInstance, which refuses it earlier.
    writeInstance(dir, "synth", { params: { Level: -3 } });
    // The module wins and the instance is REPORTED, rather than one silently replacing
    // the other — a chain naming "synth" would otherwise play whichever loaded last.
    expect(() => loadModules(dir, true)).toThrow(
      /'synth' is already a module in this project/,
    );
  });

  // --- an instance is an ordinary extender now ----------------------------
  it("merges a ui written in an instance, like any other extends", () => {
    // It used to be dropped whole: an instance had no `extends`, so the loader special-cased
    // taking the generic's grid. An instance is a plain module that extends one now, so its
    // `ui:` follows the same per-widget merge every other `extends` gets.
    const knob = (col: number, row: number, label: string) => ({
      a: { type: "knob", col, row, bind: "Level", label },
    });
    writeModule(dir, "instruments", "synth", {
      extends: "instruments/fourosc",
      ui: { cols: 1, rows: 1, widgets: knob(0, 0, "SHARED") },
    });
    writeInstance(dir, "lead", {
      extends: "@project/instruments/synth",
      ui: { cols: 2, rows: 2, widgets: knob(1, 1, "MINE") },
    });
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    const leadUi = resolved.lead.ui as {
      cols: number;
      widgets: Record<string, { label?: string }>;
    };
    expect(leadUi.cols).toBe(2);
    expect(leadUi.widgets.a.label).toBe("MINE");
  });

  it("still lets an instance override everything else", () => {
    writeInstance(dir, "lead", {
      extends: "@project/instruments/synth",
      params: { "Filter Freq": 90 },
      content: "the lead voice",
    });
    const lead = loadModules(dir).lead;
    expect(lead.params?.["Filter Freq"]).toBe(90);
    // The per-key override, on a plain scalar field. It is what makes a NOTE work: every doc
    // node is an instance of `@studio/doc`, and its own `content` is exactly this.
    expect(lead.content).toBe("the lead voice");
  });
});
