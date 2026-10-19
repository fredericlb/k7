import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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
import { writeDoc, writeNode } from "./testSupport";
import { wsData } from "./yaml/workspaceDoc";

// A node is one USE of a module, filed FLAT in `nodes/`, naming what it uses by `extends` alone.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const DEMOS = join(here, "..", "..", "..", "demos");
const SONG = join(DEMOS, "synth-demo.k7");

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
  let ws: string;
  let dir: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-inst-"));
    dir = join(ws, "synth-demo.k7");
    cpSync(SONG, dir, { recursive: true });
    // The Examples workspace's own shared library, beside every demo project.
    const shared = join(DEMOS, "_modules");
    if (existsSync(shared))
      cpSync(shared, join(ws, "_modules"), { recursive: true });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("loads nodes/<name>.k7x keyed by the BARE name", () => {
    const modules = loadModules(dir);
    const lead = modules.lead;
    expect(lead).toBeTruthy();
    expect(lead.node).toBe("lead");
    expect(lead.home).toBe("nodes"); // where its own files live
    // No "synth:lead" anywhere: the module it uses is not part of its name.
    expect(modules["synth:lead"]).toBeUndefined();
    // Which module it uses is what it EXTENDS, and that is the only place it is written.
    expect(lead.extends).toBe("@workspace/instruments/synth");
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
    writeDoc(join(ws, "_modules", "instruments", "kit", "module.k7x"), {
      type: "rack",
      rack: {
        rack_type: "samples",
        symbols: { KICK: { note: 36, clip: "k" } },
      },
    });
    writeNode(dir, "kit-1", { extends: "@workspace/instruments/kit" });
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
    // synth-pad.k7x overrides two params and empties the inherited automation list.
    expect(resolved["synth-pad"].params).toEqual({
      "Filter Freq": 40,
      Level: -12,
    });
    expect(resolved["synth-pad"].automations).toEqual([]);
    // Its sibling and the module are untouched — the merge only ever runs downhill.
    expect(resolved.lead.params?.["Filter Freq"]).toBe(90);
    expect((resolved.lead.automations as unknown[]).length).toBe(2);
    const synth = refs["@workspace/instruments/synth"];
    expect(synth.params).toBeUndefined();
    expect((synth.automations as unknown[]).length).toBe(2);
  });

  it("keeps nodes out of the `extends` vocabulary, which names MODULES", () => {
    // No engine catalogue: the machine's scanned plugins would drown a vocabulary of two.
    const refs = loadModuleRefs(dir, {});
    // Offering a USE as an `extends` target would make a second use inherit its overrides.
    expect(Object.keys(refs)).not.toContain("lead");
    expect(refs["@workspace/instruments/synth"].node).toBeUndefined();
    expect(
      refs["@workspace/instruments/synth"].params?.["Filter Freq"],
    ).toBeUndefined();
    const base = projectHints(dir).baseModules;
    expect(base).toEqual(
      expect.arrayContaining([
        "@workspace/instruments/fourosc",
        "@workspace/instruments/synth",
      ]),
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
    expect(h.modules).toContain("lead"); // the use of the shared module
    expect(h.paths["module:lead"]).toBe("nodes/lead.k7x");
  });

  it("scaffolds a new node into nodes/, naming what it uses", () => {
    const rel = createNode(dir, "instruments", "synth", "solo");
    expect(rel).toBe("nodes/solo.k7x");
    // The relationship is written down exactly once, and this is it.
    expect(wsData(join(dir, rel)).extends).toBe("@workspace/instruments/synth");
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
    expect(rel).toBe("nodes/synth_1.k7x");
    // …and the next one steps over it rather than colliding.
    expect(freeNodeName(dir, "synth")).toBe("synth_2");
  });

  it("refuses a name another NODE already has, and nothing else", () => {
    expect(() => createNode(dir, "instruments", "synth", "lead")).toThrow(
      /already exists/,
    );
    expect(() => createNode(dir, "instruments", "nope", "x")).toThrow(
      /neither in the workspace nor one the engine offers/,
    );
  });

  it("takes a MODULE's name when asked: the two are not the same thing", () => {
    // A node named after the module it uses is what an import writes, the source DAW having
    // called the track after its instrument — see docs/trackModules.md.
    expect(createNode(dir, "instruments", "synth", "synth")).toBe(
      "nodes/synth.k7x",
    );
    const mods = loadModules(dir, true);
    // The bare name is the NODE's, and the module is where it always was: behind its ref.
    expect(mods.synth?.node).toBe("synth");
    expect(
      loadModuleRefs(dir, {})["@workspace/instruments/synth"],
    ).toBeTruthy();
  });

  // --- io: made directly as a NODE now, never a module folder (docs/moduleTypes.md) ---
  it("makes an io node directly in nodes/, bare in the graph", () => {
    const rel = createNode(dir, "io", "IN", "IN");
    expect(rel).toBe("nodes/IN.k7x");
    expect(existsSync(join(dir, "modules", "io", "IN"))).toBe(false);
    // The role is what the loader reads, and what makes the graph treat it as a SOURCE.
    expect(wsData(join(dir, rel)).io).toBe("in");
    expect(loadModules(dir).IN).toMatchObject({ io: "in", kind: "io" });
  });

  it("scaffolds each source with its own role, and a second input keeps the first", () => {
    createNode(dir, "io", "IN", "IN");
    // A second input is another io node with the same role, under its own name.
    expect(createNode(dir, "io", "IN", "IN2")).toBe("nodes/IN2.k7x");
    expect(wsData(join(dir, "nodes", "IN2.k7x")).io).toBe("in");
    expect(createNode(dir, "io", "CAM", "CAM2")).toBe("nodes/CAM2.k7x");
    expect(wsData(join(dir, "nodes", "CAM2.k7x")).io).toBe("camera");
    expect(createNode(dir, "io", "FILE", "tape")).toBe("nodes/tape.k7x");
    expect(wsData(join(dir, "nodes", "tape.k7x")).io).toBe("file");
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
    // A name a node already holds is spoken for — "lead" is one of the demo's own nodes.
    expect(() => createNode(dir, "io", "IN", "lead")).toThrow(
      /already a module or node/,
    );
    createNode(dir, "io", "IN", "IN");
    // …and so is one this very verb just made.
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
    writeDoc(join(ws, "_modules", "instruments", "synth", "module.k7x"), {
      extends: "@engine/4osc",
      ui: { cols: 1, rows: 1, widgets: knob(0, 0, "SHARED") },
    });
    writeNode(dir, "lead", {
      extends: "@workspace/instruments/synth",
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
      extends: "@workspace/instruments/synth",
      params: { "Filter Freq": 90 },
      content: "the lead voice",
    });
    const lead = loadModules(dir).lead;
    expect(lead.params?.["Filter Freq"]).toBe(90);
    // The per-key override on a scalar is what makes a NOTE work: a doc node's own `content`.
    expect(lead.content).toBe("the lead voice");
  });
});
