import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");

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

  it("stays a RACK over a rack module — the type is inherited, not defaulted", () => {
    // The node states no type; anything filled in for it here would beat the rack and the
    // node would compile as an empty plugin slot, "missing plugin" and silent.
    writeModule(dir, "instruments", "kit", {
      type: "rack",
      rack: {
        rack_type: "samples",
        symbols: { KICK: { note: 36, clip: "k" } },
      },
    });
    writeNode(dir, "kit-1", { extends: "@project/instruments/kit" });
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved["kit-1"].type).toBe("rack");
    expect(Object.keys(resolved["kit-1"].rack?.symbols ?? {})).toEqual([
      "KICK",
    ]);
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

  it("refuses a name another NODE already has, and nothing else", () => {
    expect(() => createNode(dir, "instruments", "synth", "lead")).toThrow(
      /already exists/,
    );
    expect(() => createNode(dir, "instruments", "nope", "x")).toThrow(
      /neither in this project nor one the engine offers/,
    );
  });

  it("takes a MODULE's name when asked: the two are not the same thing", () => {
    // A node named after the module it uses is what an import writes, the source DAW having
    // called the track after its instrument — see docs/trackModules.md.
    expect(createNode(dir, "instruments", "synth", "synth")).toBe(
      "nodes/synth.yaml",
    );
    const mods = loadModules(dir, true);
    // The bare name is the NODE's, and the module is where it always was: behind its ref.
    expect(mods.synth?.node).toBe("synth");
    expect(loadModuleRefs(dir, {})["@project/instruments/synth"]).toBeTruthy();
  });

  // --- io: the node IS the module (docs/moduleTypes.md) -------------
  it("makes an io node the module itself — no nodes/ file, a bare name in the graph", () => {
    const rel = createNode(dir, "io", "IN", "IN");
    expect(rel).toBe("modules/io/IN/module.yaml");
    expect(existsSync(join(dir, "nodes", "IN.yaml"))).toBe(false);
    // The role is what the loader reads, and what makes the graph treat it as a SOURCE.
    const body = readFileSync(join(dir, rel), "utf8");
    expect(body).toMatch(/^io: in$/m);
    expect(loadModules(dir).IN).toMatchObject({ io: "in", kind: "io" });
  });

  it("scaffolds each source with its own role, and a second input keeps the first", () => {
    createNode(dir, "io", "IN", "IN");
    // A second input is another io module with the same role, under its own name.
    expect(createNode(dir, "io", "IN", "IN2")).toMatch(
      /modules\/io\/IN2\/module\.yaml/,
    );
    expect(
      readFileSync(join(dir, "modules/io/IN2/module.yaml"), "utf8"),
    ).toMatch(/^io: in$/m);
    expect(createNode(dir, "io", "CAM", "CAM2")).toMatch(
      /modules\/io\/CAM2\/module\.yaml/,
    );
    expect(
      readFileSync(join(dir, "modules/io/CAM2/module.yaml"), "utf8"),
    ).toMatch(/^io: camera$/m);
    expect(createNode(dir, "io", "FILE", "tape")).toMatch(
      /modules\/io\/tape\/module\.yaml/,
    );
    expect(
      readFileSync(join(dir, "modules/io/tape/module.yaml"), "utf8"),
    ).toMatch(/^io: file$/m);
    // …and the first input is untouched by any of it.
    expect(loadModules(dir).IN).toMatchObject({ io: "in" });
  });

  it("refuses an output, an unknown io name, and a name the project already holds", () => {
    // The sinks are built into every graph — MIX, OUT, CUE, RENDER, VIDEO_OUT — and take no node.
    expect(() => createNode(dir, "io", "OUT", "OUT")).toThrow(/is an OUTPUT/);
    expect(() => createNode(dir, "io", "CUE", "CUE")).toThrow(/is an OUTPUT/);
    expect(() => createNode(dir, "io", "NOPE", "x")).toThrow(
      /unknown io module/,
    );
    // A name a module or node already holds is spoken for, in either namespace.
    expect(() => createNode(dir, "io", "IN", "synth")).toThrow(
      /already a module or node/,
    );
    createNode(dir, "io", "IN", "IN");
    // …and so is one this very verb just made: the module IS the node, so it is spoken for at once.
    expect(() => createNode(dir, "io", "IN", "IN")).toThrow(
      /already a module or node/,
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
