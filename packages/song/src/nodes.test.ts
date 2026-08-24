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
  createNode,
  freeNodeName,
  loadModuleRefs,
  loadModules,
  splitModuleKey,
} from "@studio/song/loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectHints } from "./hints";
import { resolveModuleMap } from "./moduleResolve";
import { compileNodeProject } from "./nodeProject";
import { writeModule, writeNode } from "./testSupport";

// A node is one USE of a module, filed FLAT in `nodes/`, naming what it uses by `extends` alone.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
);

describe("splitModuleKey", () => {
  it("splits a ref on its first separator", () => {
    expect(splitModuleKey("synth")).toEqual({ module: "synth" });
    expect(splitModuleKey("synth:lead")).toEqual({
      module: "synth",
      node: "lead",
    });
  });
});

describe("module nodes", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-inst-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads nodes/<name>.yaml keyed by the BARE name", () => {
    const modules = loadModules(dir);
    expect(Object.keys(modules)).toContain("synth"); // the module is still there
    const lead = modules.lead;
    expect(lead).toBeTruthy();
    expect(lead.node).toBe("lead");
    expect(lead.home).toBe("nodes"); // where its own files live
    // No "synth:lead" anywhere: the module it uses is not part of its name.
    expect(modules["synth:lead"]).toBeUndefined();
    // Which module it uses is what it EXTENDS, and that is the only place it is written.
    expect(lead.extends).toBe("@project/instruments/synth");
    expect(lead.params?.["Filter Freq"]).toBe(90);
  });

  it("takes its type from what it extends, having no type folder of its own", () => {
    // Why a flat folder works: `kind`, `inputs` and `category` arrive through extends, not a path.
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved.lead.category).toBe("instruments");
    expect(resolved.lead.kind).toBe("plugin");
    expect(resolved.lead.inputs).toEqual([{ name: "midi", type: "midi" }]);
  });

  it("lets a node override the module while leaving it untouched", () => {
    const modules = loadModules(dir);
    const refs = loadModuleRefs(dir, {});
    const resolved = resolveModuleMap(modules, refs);
    // synth-pad.yaml overrides two params and empties the inherited automation list.
    expect(resolved["synth-pad"].params).toEqual({
      "Filter Freq": 40,
      Level: -12,
    });
    expect(resolved["synth-pad"].automations).toEqual([]);
    // Its sibling and the module are untouched — the merge only ever runs downhill.
    expect(resolved.lead.params?.["Filter Freq"]).toBe(90);
    expect((resolved.lead.automations as unknown[]).length).toBe(2);
    expect(modules.synth.params).toBeUndefined();
    expect((modules.synth.automations as unknown[]).length).toBe(2);
  });

  it("keeps nodes out of the `extends` vocabulary, which names MODULES", () => {
    // No engine catalogue: the machine's scanned plugins would drown a vocabulary of two.
    const refs = loadModuleRefs(dir, {});
    // Offering a USE as an `extends` target would make a second use inherit its overrides.
    expect(Object.keys(refs)).not.toContain("lead");
    expect(refs["instruments/synth"].node).toBeUndefined();
    expect(refs["instruments/synth"].params?.["Filter Freq"]).toBeUndefined();
    const base = projectHints(dir).baseModules;
    expect(base).toEqual(
      expect.arrayContaining(["instruments/fourosc", "instruments/synth"]),
    );
    expect(base).not.toContain("lead");
  });

  it("compiles two nodes of one module into two independent plugins", () => {
    // The demo's chains name "lead" and "synth-pad" — one module, two voices.
    const doc = compileNodeProject(dir);
    const lead = doc.tracks
      .find((t) => t.id === "melody")
      // "melody", not "lead": a chain is called after its track, there being no `as:` alias.
      ?.plugins.find((p) => p.id === "melody:lead");
    const pad = doc.tracks
      .find((t) => t.id === "pad")
      ?.plugins.find((p) => p.id === "pad:synth-pad");
    expect(lead).toBeTruthy();
    expect(pad).toBeTruthy();
    // The plugin is inherited through instruments/synth -> instruments/fourosc by both.
    expect(lead?.type).toBe("4osc");
    expect(pad?.type).toBe("4osc");
    expect(lead?.params?.["Filter Freq"]).toBe(90);
    expect(pad?.params?.["Filter Freq"]).toBe(40);
    // Each saves its opaque state beside ITS OWN FILE, so a UI edit leaves the other alone.
    expect(lead?.presetSave.replace(/\\/g, "/")).toMatch(
      /nodes\/lead\.vstpreset$/,
    );
    expect(pad?.presetSave.replace(/\\/g, "/")).toMatch(
      /nodes\/synth-pad\.vstpreset$/,
    );
  });

  it("offers nodes to the editor, each linked to its own file", () => {
    const h = projectHints(dir);
    expect(h.modules).toContain("synth"); // the module
    expect(h.modules).toContain("lead"); // and the use of it
    expect(h.paths["module:lead"]).toBe("nodes/lead.yaml");
    expect(h.paths["module:synth"]).toBe(
      "modules/instruments/synth/module.yaml",
    );
  });

  it("scaffolds a new node into nodes/, naming what it uses", () => {
    const rel = createNode(dir, "instruments", "synth", "solo");
    expect(rel).toBe("nodes/solo.yaml");
    // The relationship is written down exactly once, and this is it.
    expect(readFileSync(join(dir, rel), "utf8")).toMatch(
      /^extends: "@project\/instruments\/synth"$/m,
    );
    const solo = loadModules(dir).solo;
    expect(solo.node).toBe("solo");
    expect(projectHints(dir).modules).toContain("solo");
    // …and it resolves through that ref to the plugin two levels up.
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved.solo.plugin).toMatchObject({ name: "4osc" });
  });

  it("names a node by itself when nobody said — and proposes only free names", () => {
    // A node born wired to nothing has no run to be named after, so it is named by itself.
    expect(freeNodeName(dir, "synth")).toBe("synth_1");
    expect(freeNodeName(dir, "synth", "vo.jo")).toBe("vo_jo_synth_1");
    // What it proposes, `createNode` accepts — which is the whole contract between the two.
    const rel = createNode(
      dir,
      "instruments",
      "synth",
      freeNodeName(dir, "synth"),
    );
    expect(rel).toBe("nodes/synth_1.yaml");
    // …and the next one steps over it rather than colliding.
    expect(freeNodeName(dir, "synth")).toBe("synth_2");
  });

  it("steps over a name a MODULE holds, not just a node", () => {
    // One flat key, so a proposal has to dodge the module space as well as the `nodes/` folder.
    expect(freeNodeName(dir, "eq", "vo")).toBe("vo_eq_1");
    writeModule(dir, "audio", "vo_eq_1", {
      plugin: { type: "internal", name: "EQ" },
    });
    expect(freeNodeName(dir, "eq", "vo")).toBe("vo_eq_2");
  });

  it("refuses a name already taken, project-wide", () => {
    expect(() => createNode(dir, "instruments", "synth", "lead")).toThrow(
      /already names a module or node/,
    );
    // One flat key, so a MODULE's name is taken too: "synth" must not mean two things.
    expect(() => createNode(dir, "instruments", "synth", "synth")).toThrow(
      /already names a module or node/,
    );
    expect(() => createNode(dir, "instruments", "nope", "x")).toThrow(
      /neither in this project nor one the engine offers/,
    );
  });

  it("refuses to shadow a module with a node of the same name", () => {
    // Written by hand rather than through createNode, which refuses it earlier.
    writeNode(dir, "synth", { params: { Level: -3 } });
    // Reported rather than silently replaced: a chain would otherwise play whichever loaded last.
    expect(() => loadModules(dir, true)).toThrow(
      /'synth' is already a module in this project/,
    );
  });

  // --- a node is an ordinary extender -------------------------------
  it("merges a ui written in a node, like any other extends", () => {
    // A node's `ui:` follows the ordinary per-widget merge, not a wholesale drop.
    const knob = (col: number, row: number, label: string) => ({
      a: { type: "knob", col, row, bind: "Level", label },
    });
    writeModule(dir, "instruments", "synth", {
      extends: "instruments/fourosc",
      ui: { cols: 1, rows: 1, widgets: knob(0, 0, "SHARED") },
    });
    writeNode(dir, "lead", {
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

  it("still lets a node override everything else", () => {
    writeNode(dir, "lead", {
      extends: "@project/instruments/synth",
      params: { "Filter Freq": 90 },
      content: "the lead voice",
    });
    const lead = loadModules(dir).lead;
    expect(lead.params?.["Filter Freq"]).toBe(90);
    // The per-key override on a scalar is what makes a NOTE work: a doc node's own `content`.
    expect(lead.content).toBe("the lead voice");
  });
});
