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
} from "@lanes/song/loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectHints } from "./hints";
import { compileNodeProject } from "./nodeProject";
import { writeModule } from "./testSupport";

// Module INSTANCES: a module's folder holds module.yaml (the generic, used in chains by
// the folder's name) and any number of `<instance>.yaml` files, each inheriting module.yaml
// automatically and referenced as "<module>:<instance>". These check the whole path — the
// loader's merge, the compiler, the hints the editor completes from, and the overlay that
// pins a chain step to the real set.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(here, "..", "..", "..", "engine-tray", "songs", "synth-demo");

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

  it("loads an instance beside the generic, keyed <module>:<instance>", () => {
    const modules = loadModules(dir);
    expect(Object.keys(modules)).toContain("synth"); // the generic is still there
    const lead = modules["synth:lead"];
    expect(lead).toBeTruthy();
    expect(lead.category).toBe("instruments");
    expect(lead.file).toBe("synth"); // the module's FOLDER
    expect(lead.instance).toBe("lead");
    // Inherited from module.yaml without an `extends` in the instance file…
    expect(lead.extends).toBe("instruments/fourosc");
    // …and its own override on top.
    expect(lead.params?.["Filter Freq"]).toBe(90);
  });

  it("lets an instance override the generic while leaving it untouched", () => {
    const modules = loadModules(dir);
    // pad.yaml overrides two params and empties the inherited automation list.
    expect(modules["synth:pad"].params).toEqual({
      "Filter Freq": 40,
      Level: -12,
    });
    expect(modules["synth:pad"].automations).toEqual([]);
    // Its sibling and the generic are untouched — the merge only ever runs downhill.
    expect(modules["synth:lead"].params).toEqual({ "Filter Freq": 90 });
    expect((modules["synth:lead"].automations as unknown[]).length).toBe(2);
    expect(modules.synth.params).toBeUndefined();
    expect((modules.synth.automations as unknown[]).length).toBe(2);
  });

  it("keeps instances out of the `extends` vocabulary, which names FOLDERS", () => {
    // No engine catalogue here: this asks what the project's FILES define, and the
    // machine's scanned plugins would drown a vocabulary of two.
    const refs = loadModuleRefs(dir, [], {});
    // An instance shares its module's folder, so re-keying it by ref would land on the
    // generic's own key and replace it — every `extends` of the module would then
    // inherit that one instance's overrides.
    expect(Object.keys(refs)).not.toContain("instruments/synth:lead");
    expect(refs["instruments/synth"].instance).toBeUndefined();
    expect(refs["instruments/synth"].params?.["Filter Freq"]).toBeUndefined();
    // …and the completion list an `extends` offers stays module-level. It also carries
    // the engine's own modules now — that is what the catalogue is FOR — so this asserts
    // what must be in it and what must not, rather than the whole of it.
    const base = projectHints(dir).baseModules;
    expect(base).toEqual(
      expect.arrayContaining(["instruments/fourosc", "instruments/synth"]),
    );
    expect(base).not.toContain("instruments/synth:lead");
  });

  it("compiles two instances of one module into two independent plugins", () => {
    // The demo's chains name "synth:lead" and "synth:pad" — one module, two voices.
    const doc = compileNodeProject(dir);
    const lead = doc.tracks
      .find((t) => t.id === "melody")
      // "melody", not "lead": a chain is called after its track now — the `as:` alias
      // that renamed it went with the list format.
      ?.plugins.find((p) => p.id === "melody:synth:lead");
    const pad = doc.tracks
      .find((t) => t.id === "pad")
      ?.plugins.find((p) => p.id === "pad:synth:pad");
    expect(lead).toBeTruthy();
    expect(pad).toBeTruthy();
    // The plugin is inherited through module.yaml -> instruments/fourosc by both.
    expect(lead?.type).toBe("4osc");
    expect(pad?.type).toBe("4osc");
    expect(lead?.params?.["Filter Freq"]).toBe(90);
    expect(pad?.params?.["Filter Freq"]).toBe(40);
    // Each saves its own opaque state, so a UI edit on one leaves the other — and the
    // generic they share — alone.
    expect(lead?.presetSave.replace(/\\/g, "/")).toMatch(
      /modules\/instruments\/synth\/lead\.vstpreset$/,
    );
    expect(pad?.presetSave.replace(/\\/g, "/")).toMatch(
      /modules\/instruments\/synth\/pad\.vstpreset$/,
    );
  });

  it("offers instances to the editor, each linked to its own file", () => {
    const h = projectHints(dir);
    expect(h.modules).toContain("synth"); // the generic
    expect(h.modules).toContain("synth:lead");
    // The instance links to its OWN file, not the generic it inherits.
    expect(h.paths["module:synth:lead"]).toBe(
      "modules/instruments/synth/lead.yaml",
    );
    expect(h.paths["module:synth"]).toBe(
      "modules/instruments/synth/module.yaml",
    );
  });

  it("scaffolds a new instance into an existing module's folder", () => {
    const rel = createModuleInstance(dir, "instruments", "synth", "solo");
    expect(rel).toBe("modules/instruments/synth/solo.yaml");
    // Scaffolded EMPTY — there is no `extends` to write, the folder is the parent.
    expect(readFileSync(join(dir, rel), "utf8")).not.toMatch(/^extends:/m);
    const solo = loadModules(dir)["synth:solo"];
    expect(solo.instance).toBe("solo");
    expect(solo.extends).toBe("instruments/fourosc"); // inherited, unstated
    expect(projectHints(dir).modules).toContain("synth:solo");
  });

  it("refuses an instance that would collide or has nothing to inherit", () => {
    expect(() =>
      createModuleInstance(dir, "instruments", "synth", "lead"),
    ).toThrow(/already exists/);
    expect(() =>
      createModuleInstance(dir, "instruments", "synth", "module"),
    ).toThrow(/reserved/);
    // A name that is neither a module of this project nor one the engine offers. The
    // second half matters now: a folder with no `module.yaml` is legitimate when the
    // engine provides the module, so "there is no file here" is no longer a refusal on
    // its own — the message has to say both places were looked in.
    expect(() =>
      createModuleInstance(dir, "instruments", "nope", "lead"),
    ).toThrow(/neither in this project nor one the engine offers/);
  });

  // --- a UI belongs to the MODULE, not to one use of it ------------------
  it("takes the generic's ui and ignores one written in an instance file", () => {
    // The web module editor edits the GENERIC file for any instance you pick, so a `ui:`
    // in an instance would be a grid nothing can reach — it has no effect at all.
    const knob = (col: number, row: number, label: string) => ({
      a: { type: "knob", col, row, bind: "Level", label },
    });
    writeModule(dir, "instruments", "synth", {
      extends: "instruments/fourosc",
      ui: { cols: 1, rows: 1, widgets: knob(0, 0, "SHARED") },
    });
    writeModule(
      dir,
      "instruments",
      "synth",
      { ui: { cols: 2, rows: 2, widgets: knob(1, 1, "MINE") } },
      "lead",
    );
    const modules = loadModules(dir);
    // Whole, not merged per widget: the instance's grid is not half-applied either.
    expect(modules["synth:lead"].ui).toEqual(modules.synth.ui);
    const leadUi = modules["synth:lead"].ui as {
      cols: number;
      widgets: Record<string, { label?: string }>;
    };
    expect(leadUi.cols).toBe(1);
    expect(leadUi.widgets.a.label).toBe("SHARED");
  });

  it("still lets an instance override everything else", () => {
    writeModule(
      dir,
      "instruments",
      "synth",
      { params: { "Filter Freq": 90 }, docs: "the lead voice" },
      "lead",
    );
    const lead = loadModules(dir)["synth:lead"];
    expect(lead.params?.["Filter Freq"]).toBe(90);
    expect(lead.docs).toBe("the lead voice");
  });
});
