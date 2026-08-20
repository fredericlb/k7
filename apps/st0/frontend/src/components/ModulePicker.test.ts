import { describe, expect, it } from "vitest";
import {
  buildTree,
  type PickerModule,
  parseBaseRef,
  SEARCH_LIMIT,
  searchModules,
} from "./ModulePicker";

// Refs in the shape scanModules actually writes (loader.ts): a namespaced folder, then
// <type>/<category>/<slug>, with the category level dropped for a plugin that declared
// nothing usable. Sampled from a real _modules tree (namespace "engine", 250 modules —
// 205 with a category, 45 without).
const CATALOGUE = [
  "@engine/audio/delay/adt",
  "@engine/audio/delay/hombre",
  "@engine/audio/distortion/drive",
  "@engine/instruments/4osc",
  "@engine/instruments/analog-lab-v",
];

describe("parseBaseRef", () => {
  it("splits namespace / type / category / name", () => {
    expect(parseBaseRef("@engine/audio/delay/adt")).toEqual({
      namespace: "engine",
      type: "audio",
      category: "delay",
      name: "adt",
    });
  });

  it("treats the category level as optional", () => {
    expect(parseBaseRef("@engine/instruments/4osc")).toEqual({
      namespace: "engine",
      type: "instruments",
      category: null,
      name: "4osc",
    });
  });

  it("reports a local ref as having no namespace", () => {
    expect(parseBaseRef("instruments/synth").namespace).toBeNull();
  });
});

describe("buildTree", () => {
  it("nests namespace -> type -> category", () => {
    const tree = buildTree(CATALOGUE);
    expect(tree.map((n) => n.label)).toEqual(["@engine"]);
    const ns = tree[0];
    expect(ns.children?.map((c) => c.label).sort()).toEqual([
      "audio",
      "instruments",
    ]);
    const audio = ns.children?.find((c) => c.label === "audio");
    expect(audio?.children?.map((c) => c.label)).toEqual([
      "delay",
      "distortion",
    ]);
    const delay = audio?.children?.find((c) => c.label === "delay");
    expect(delay?.children?.map((c) => c.label)).toEqual(["adt", "hombre"]);
    expect(delay?.children?.[0].entry).toEqual({
      ref: "@engine/audio/delay/adt",
      namespace: "engine",
      type: "audio",
      name: "adt",
    });
  });

  it("hangs an uncategorised module directly off its type", () => {
    // No "Other" bucket inside a type: 4osc declares no category, so it sits beside the
    // category submenus rather than one level deeper than everything else.
    const instruments = buildTree(CATALOGUE)[0].children?.find(
      (c) => c.label === "instruments",
    );
    expect(instruments?.children?.map((c) => c.label)).toEqual([
      "4osc",
      "analog-lab-v",
    ]);
  });

  it("groups the project's own base modules under `current`, first", () => {
    // A ref with no namespace is one this project defines. It is a real choice — you
    // node it rather than creating anything — so it leads the first level.
    const tree = buildTree(["instruments/synth", ...CATALOGUE]);
    expect(tree.map((n) => n.label)).toEqual(["current", "@engine"]);
    const synth = tree[0].children?.find((t) => t.label === "instruments")
      ?.children?.[0];
    expect(synth?.entry).toEqual({
      ref: "instruments/synth",
      namespace: null, // ⇒ node it directly; nothing to create first
      type: "instruments",
      name: "synth",
    });
  });

  it("is empty when there is nothing to offer", () => {
    expect(buildTree([])).toEqual([]);
  });
});

// The shape the ENGINE answers in: no folders, so no filing inside the ref. What an ADT
// is comes from the module, and the picker is handed it rather than parsing it out.
const ENGINE: PickerModule[] = [
  { ref: "@engine/adt", category: "audio" },
  { ref: "@engine/4osc", category: "instruments" },
  { ref: "@engine/IN", category: "io" },
];

describe("a module whose ref does not spell out its filing", () => {
  it("files it under the category it declares", () => {
    // The regression this covers: with the engine's modules keyed `@engine/adt`, the
    // parser reports no type and every one of the 253 vanished from the picker.
    const ns = buildTree(ENGINE)[0];
    expect(ns.label).toBe("@engine");
    expect(ns.children?.map((c) => c.label)).toEqual([
      "audio",
      "instruments",
      "io",
    ]);
    expect(ns.children?.[0].children?.[0].entry).toEqual({
      ref: "@engine/adt",
      namespace: "engine",
      type: "audio",
      name: "adt",
    });
  });

  it("drops one that declares nothing either", () => {
    // Not a silent bug to hide: with no type there is no level to hang it off.
    expect(buildTree([{ ref: "@engine/adt" }])).toEqual([]);
  });

  it("still reads a ref that DOES say it — a library module is a folder", () => {
    // `@library/audio/wah/auto-wah` is on disk, so its path is its filing and the
    // category the catalogue reports must not override it.
    const tree = buildTree([
      { ref: "@library/audio/wah/auto-wah", category: "audio" },
    ]);
    const audio = tree[0].children?.[0];
    expect(audio?.label).toBe("audio");
    expect(audio?.children?.[0].label).toBe("wah");
  });

  it("searches it like any other", () => {
    expect(searchModules(ENGINE, "adt").map((n) => n.entry)).toEqual([
      { ref: "@engine/adt", namespace: "engine", type: "audio", name: "adt" },
    ]);
  });
});

describe("searchModules", () => {
  const refs = (q: string) =>
    searchModules(CATALOGUE, q).map((n) => n.entry?.ref);

  it("finds a module wherever it sits in the tree", () => {
    // The point of the search: one query reaches across every namespace, type and
    // category, so a module you can name doesn't cost four hovers to reach.
    expect(refs("adt")).toEqual(["@engine/audio/delay/adt"]);
    expect(refs("4osc")).toEqual(["@engine/instruments/4osc"]);
  });

  it("drops the fuzzy noise once something matches as written", () => {
    // "adt" is ALSO a subsequence of @engine/audio/distortion/drive (and, in the real
    // 273-module catalogue, of 39 others). A module actually called `adt` exists, so the
    // scattered ones are dropped rather than listed under it.
    expect(refs("adt")).not.toContain("@engine/audio/distortion/drive");
    // With nothing matching literally, the subsequence hits are all there is — that is
    // what makes the search forgive a half-remembered name.
    expect(refs("ado")).toContain("@engine/audio/delay/adt");
  });

  it("matches on the path too, so a category or namespace narrows", () => {
    expect(refs("delay")).toEqual([
      "@engine/audio/delay/adt",
      "@engine/audio/delay/hombre",
    ]);
    expect(refs("instruments")).toEqual([
      "@engine/instruments/4osc",
      "@engine/instruments/analog-lab-v",
    ]);
    // A slashed query narrows level by level: each part has to hit a DIFFERENT segment
    // of the ref, so "engine/dist" means the engine namespace then the distortions, and
    // not "these letters, anywhere".
    expect(refs("engine/dist")).toEqual(["@engine/audio/distortion/drive"]);
    expect(refs("audio/delay")).toEqual([
      "@engine/audio/delay/adt",
      "@engine/audio/delay/hombre",
    ]);
  });

  it("puts a name match above a path-only one", () => {
    // "drive" IS a module and is also a subsequence of several paths. The one actually
    // called that has to come first, or the search is useless for the case it exists for.
    expect(refs("drive")[0]).toBe("@engine/audio/distortion/drive");
  });

  it("searches the project's own modules alongside the catalogue", () => {
    expect(refs("synth")).toEqual([]); // not in CATALOGUE
    expect(
      searchModules(["instruments/synth", ...CATALOGUE], "synth").map(
        (n) => n.entry,
      ),
    ).toEqual([
      {
        ref: "instruments/synth",
        namespace: null,
        type: "instruments",
        name: "synth",
      },
    ]);
  });

  it("answers nothing to an empty query — the tree is the answer then", () => {
    expect(searchModules(CATALOGUE, "")).toEqual([]);
    expect(searchModules(CATALOGUE, "   ")).toEqual([]);
  });

  it("stops listing past the limit", () => {
    const many = Array.from(
      { length: SEARCH_LIMIT + 10 },
      (_, i) => `@engine/audio/delay/echo${i}`,
    );
    expect(searchModules(many, "echo")).toHaveLength(SEARCH_LIMIT);
  });
});
