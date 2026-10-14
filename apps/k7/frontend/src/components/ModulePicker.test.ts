import { describe, expect, it } from "vitest";
import {
  buildTree,
  type PickerModule,
  parseBaseRef,
  SEARCH_LIMIT,
  searchModules,
} from "./ModulePicker";

// Refs in the shape scanModules actually writes (loader.ts), sampled from a real _modules tree of 250 modules, 45 without a category.
const CATALOGUE = [
  "@k7-core/audio/delay/adt",
  "@k7-core/audio/delay/hombre",
  "@k7-core/audio/distortion/drive",
  "@k7-core/instruments/4osc",
  "@k7-core/instruments/analog-lab-v",
];

// The machine's plugin scan, which this picker refuses whatever shape it arrives in.
const ENGINE_REFS = ["@engine/audio/delay/adt", "@engine/instruments/4osc"];

describe("parseBaseRef", () => {
  it("splits namespace / type / category / name", () => {
    expect(parseBaseRef("@k7-core/audio/delay/adt")).toEqual({
      namespace: "k7-core",
      type: "audio",
      category: "delay",
      name: "adt",
    });
  });

  it("treats the category level as optional", () => {
    expect(parseBaseRef("@k7-core/instruments/4osc")).toEqual({
      namespace: "k7-core",
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
    expect(tree.map((n) => n.label)).toEqual(["@k7-core"]);
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
      ref: "@k7-core/audio/delay/adt",
      namespace: "k7-core",
      type: "audio",
      name: "adt",
    });
  });

  it("hangs an uncategorised module directly off its type", () => {
    // No 'Other' bucket inside a type: 4osc declares no category, so it sits beside the category submenus.
    const instruments = buildTree(CATALOGUE)[0].children?.find(
      (c) => c.label === "instruments",
    );
    expect(instruments?.children?.map((c) => c.label)).toEqual([
      "4osc",
      "analog-lab-v",
    ]);
  });

  it("groups the project's own base modules under `current`, first", () => {
    // A ref with no namespace is one this project defines — a real choice, so it leads the first level.
    const tree = buildTree(["instruments/synth", ...CATALOGUE]);
    expect(tree.map((n) => n.label)).toEqual(["current", "@k7-core"]);
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

  it("draws the module's file name, keeping the ref as the row's hint", () => {
    const [ns] = buildTree(["@k7-core/audio/delay/adt"]);
    const leaf = ns.children?.[0].children?.[0].children?.[0];
    expect(leaf?.label).toBe("adt");
    // What a pick WRITES is the ref, so the row has to show it somewhere.
    expect(leaf?.hint).toBe("@k7-core/audio/delay/adt");
    expect(leaf?.entry?.name).toBe("adt");
  });

  it("offers no `@engine` ref: a built-in is a base to extend, not a node to drop", () => {
    // The machine's plugin scan would also bury a project's dozen modules under a rig's four hundred.
    expect(buildTree(ENGINE_REFS)).toEqual([]);
    expect(buildTree([{ ref: "@engine/adt", category: "audio" }])).toEqual([]);
    // …and the rest of the list is untouched by that rule.
    expect(
      buildTree([...ENGINE_REFS, ...CATALOGUE]).map((n) => n.label),
    ).toEqual(["@k7-core"]);
  });
});

// A ref that spells no folder: nothing to file it by inside the ref, so what it IS comes from the catalogue entry.
const FLAT: PickerModule[] = [
  { ref: "@k7-core/adt", category: "audio" },
  { ref: "@k7-core/4osc", category: "instruments" },
  { ref: "@k7-core/IN", category: "io" },
];

describe("a module whose ref does not spell out its filing", () => {
  it("files it under the category it declares", () => {
    // The failure it guards: keyed `@k7-core/adt`, the parser reports no type and every one of them vanishes from the picker.
    const ns = buildTree(FLAT)[0];
    expect(ns.label).toBe("@k7-core");
    expect(ns.children?.map((c) => c.label)).toEqual([
      "audio",
      "instruments",
      "io",
    ]);
    expect(ns.children?.[0].children?.[0].entry).toEqual({
      ref: "@k7-core/adt",
      namespace: "k7-core",
      type: "audio",
      name: "adt",
    });
  });

  it("drops one that declares nothing either", () => {
    // Not a silent bug to hide: with no type there is no level to hang it off.
    expect(buildTree([{ ref: "@k7-core/adt" }])).toEqual([]);
  });

  it("still reads a ref that DOES say it — a library module is a folder", () => {
    // `@library/audio/wah/auto-wah` is on disk, so its path is its filing and the catalogue's category must not override it.
    const tree = buildTree([
      { ref: "@library/audio/wah/auto-wah", category: "audio" },
    ]);
    const audio = tree[0].children?.[0];
    expect(audio?.label).toBe("audio");
    expect(audio?.children?.[0].label).toBe("wah");
  });

  it("searches it like any other", () => {
    expect(searchModules(FLAT, "adt").map((n) => n.entry)).toEqual([
      { ref: "@k7-core/adt", namespace: "k7-core", type: "audio", name: "adt" },
    ]);
  });
});

describe("searchModules", () => {
  const refs = (q: string) =>
    searchModules(CATALOGUE, q).map((n) => n.entry?.ref);

  it("finds a module wherever it sits in the tree", () => {
    // The point of the search: one query reaches across every namespace, type and category.
    expect(refs("adt")).toEqual(["@k7-core/audio/delay/adt"]);
    expect(refs("4osc")).toEqual(["@k7-core/instruments/4osc"]);
  });

  it("drops the fuzzy noise once something matches as written", () => {
    // 'adt' is ALSO a subsequence of other refs; a module actually called `adt` exists, so the scattered ones are dropped.
    expect(refs("adt")).not.toContain("@k7-core/audio/distortion/drive");
    // With nothing matching literally, the subsequence hits are all there is — what makes the search forgive a half-remembered name.
    expect(refs("ado")).toContain("@k7-core/audio/delay/adt");
  });

  it("reaches no `@engine` ref either — a search past the tree's rule is the same leak", () => {
    expect(
      searchModules([...ENGINE_REFS, ...CATALOGUE], "adt").map(
        (n) => n.entry?.ref,
      ),
    ).toEqual(["@k7-core/audio/delay/adt"]);
    // The FLAT shape too, which is the one that actually arrives: `moduleCatalogue` drops a
    // three-segment engine ref and keeps `@engine/<slug>`, category and all.
    expect(
      searchModules(
        [{ ref: "@engine/adt", category: "audio" }, ...CATALOGUE],
        "adt",
      ).map((n) => n.entry?.ref),
    ).toEqual(["@k7-core/audio/delay/adt"]);
  });

  it("matches on the path too, so a category or namespace narrows", () => {
    expect(refs("delay")).toEqual([
      "@k7-core/audio/delay/adt",
      "@k7-core/audio/delay/hombre",
    ]);
    expect(refs("instruments")).toEqual([
      "@k7-core/instruments/4osc",
      "@k7-core/instruments/analog-lab-v",
    ]);
    // A slashed query narrows level by level: each part has to hit a DIFFERENT segment of the ref.
    expect(refs("k7-core/dist")).toEqual(["@k7-core/audio/distortion/drive"]);
    expect(refs("audio/delay")).toEqual([
      "@k7-core/audio/delay/adt",
      "@k7-core/audio/delay/hombre",
    ]);
  });

  it("puts a name match above a path-only one", () => {
    // 'drive' IS a module and also a subsequence of several paths; the one actually called that has to come first.
    expect(refs("drive")[0]).toBe("@k7-core/audio/distortion/drive");
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
      (_, i) => `@k7-core/audio/delay/echo${i}`,
    );
    expect(searchModules(many, "echo")).toHaveLength(SEARCH_LIMIT);
  });
});
