// A module's ALTERNATIVES: named attribute sets it can be switched between. What is pinned here
// is the MERGE — an alternative is an ordinary extender of its own module, so `params` merge per
// entry and a list replaces outright — and the order against `extends`, which is the one thing a
// reader cannot guess. See docs/alternatives.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { K7Document, type K7Scope, parse } from "@studio/k7x/document";
import {
  alternativesOf,
  currentAlternative,
} from "@studio/song-schema/alternatives";
import {
  addAlternative,
  setAlternative,
} from "@studio/song-schema/yaml/alternativeFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAlternative } from "./alternatives";
import { loadGraph } from "./graph";
import { loadModuleRefs, loadModules } from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";
import { writeDoc, writeNode } from "./testSupport";
import { wsEdit } from "./yaml/workspaceDoc";

const mod = (m: Partial<LoadedModule>): LoadedModule =>
  ({ kind: "plugin", inputs: [], ...m }) as LoadedModule;

describe("applying one", () => {
  it("merges `params` per ENTRY — a set states only what it changes", () => {
    const m = mod({
      params: { Gain: 3, Tone: 5 },
      alternative: "crunch",
      alternatives: [{ name: "crunch", params: { Gain: 9 } }],
    });
    expect(applyAlternative(m).params).toEqual({ Gain: 9, Tone: 5 });
  });

  it("replaces a LIST outright, which is what a lane's events need", () => {
    const m = mod({
      events: [{ ref: "a" }, { ref: "b" }],
      alternative: "take2",
      alternatives: [{ name: "take2", events: [{ ref: "c" }] }],
    });
    expect(applyAlternative(m).events).toEqual([{ ref: "c" }]);
  });

  it("may set ANY module field, not just params", () => {
    const m = mod({
      plugin: { type: "internal", name: "Chorus" },
      alternative: "twin",
      alternatives: [
        { name: "twin", plugin: { type: "vst3", name: "Twin" }, color: "#c00" },
      ],
    });
    const out = applyAlternative(m);
    expect(out.plugin).toEqual({ type: "vst3", name: "Twin" });
    expect(out.color).toBe("#c00");
  });

  it("does NOT rename the module to the name of its variant", () => {
    // `name` is OWN_ONLY: merging it would silently rewrite the key every chain step names.
    const m = mod({
      name: "ampli",
      alternative: "crunch",
      alternatives: [{ name: "crunch", params: { Gain: 9 } }],
    });
    expect(applyAlternative(m).name).toBe("ampli");
  });

  it("leaves the list itself on the module, so a surface can still draw it", () => {
    const m = mod({
      alternative: "crunch",
      alternatives: [{ name: "crunch" }],
    });
    expect(currentAlternative(applyAlternative(m))).toBe(1);
    expect(alternativesOf(applyAlternative(m))).toHaveLength(2);
  });

  it("is a no-op when the first is on, or when the name answers to nothing", () => {
    const m = mod({ params: { Gain: 3 }, alternatives: [{ name: "x" }] });
    expect(applyAlternative(m)).toBe(m);
    expect(applyAlternative({ ...m, alternative: "ghost" })).toEqual({
      ...m,
      alternative: "ghost",
    });
  });
});

describe("against `extends`", () => {
  it("wins: the ancestry is folded FIRST, then the chosen set", () => {
    const refs = {
      "audio/amp": mod({ params: { Gain: 1, Tone: 5 } }),
    };
    const out = resolveModuleMap(
      {
        ampli: mod({
          extends: "audio/amp",
          params: { Gain: 3 },
          alternative: "crunch",
          alternatives: [{ name: "crunch", params: { Gain: 9 } }],
        }),
      },
      refs,
    );
    // base 1 → own 3 → crunch 9, and Tone survives all three.
    expect(out.ampli.params).toEqual({ Gain: 9, Tone: 5 });
  });

  it("picks from a list its PARENT declared", () => {
    // The parent's own choice is NOT applied first: `base + clean + crunch` is not what it says.
    const refs = {
      "audio/amp": mod({
        params: { Gain: 1 },
        alternative: "clean",
        alternatives: [
          { name: "clean", params: { Gain: 2 } },
          { name: "crunch", params: { Gain: 9 } },
        ],
      }),
    };
    const out = resolveModuleMap(
      { ampli: mod({ extends: "audio/amp", alternative: "crunch" }) },
      refs,
    );
    expect(out.ampli.params).toEqual({ Gain: 9 });
  });

  it("honours the parent's own choice when the child makes none", () => {
    const refs = {
      "audio/amp": mod({
        params: { Gain: 1 },
        alternative: "clean",
        alternatives: [{ name: "clean", params: { Gain: 2 } }],
      }),
    };
    const out = resolveModuleMap(
      { ampli: mod({ extends: "audio/amp" }) },
      refs,
    );
    expect(out.ampli.params).toEqual({ Gain: 2 });
  });
});

describe("the file the app writes", () => {
  const AUTHORED = `// the amp
extends("@workspace/audio/amp")
params({ Gain: 3, Tone: 5 })
alternatives([name("crunch").params({ Gain: 9 })])
`;
  // Runs one writer on the whole file, as the app does, and answers the text it leaves.
  const edit = (text: string, f: (doc: K7Scope) => void): string => {
    const doc = new K7Document(text);
    f(doc.at([]));
    return doc.toString();
  };
  const switchTo = (text: string, name: string) =>
    edit(text, (doc) => setAlternative(doc, name));

  it("switches by ADDING one line, keeping every other byte", () => {
    const after = switchTo(AUTHORED, "crunch");
    expect(after).toContain('alternative("crunch")');
    // Take the selection back out and the file is what it was, comments and key order included.
    expect(after.replace('alternative("crunch")\n', "")).toBe(AUTHORED);
  });

  it("clears the key going back to the first, rather than writing `alternative: 1`", () => {
    const on = switchTo(AUTHORED, "crunch");
    expect(switchTo(on, "1")).toBe(AUTHORED);
  });

  it("refuses a name the module does not have", () => {
    expect(() => switchTo(AUTHORED, "ghost")).toThrow(/no alternative/);
  });

  it("adds an EMPTY one and switches to it — a set states only what it changes", () => {
    let name = "";
    const text = edit(AUTHORED, (doc) => {
      name = addAlternative(doc, "clean");
    });
    expect(name).toBe("clean");
    const data = parse(text);
    expect(data.alternative).toBe("clean");
    // Empty, so it plays the module as authored until you change something.
    expect((data.alternatives as unknown[])[1]).toEqual({ name: "clean" });
  });

  it("numbers an unnamed one after the last, counting the first", () => {
    let name = "";
    edit(AUTHORED, (doc) => {
      name = addAlternative(doc);
    });
    expect(name).toBe("3");
  });

  it("copies the set that is CURRENTLY on, not the module's own", () => {
    const on = switchTo(AUTHORED, "crunch");
    const text = edit(on, (doc) => {
      addAlternative(doc, "crunchier", { copy: true });
    });
    // crunch's OWN fields: baking Tone in would cut the copy off from later edits to the module.
    expect((parse(text).alternatives as unknown[])[1]).toEqual({
      name: "crunchier",
      params: { Gain: 9 },
    });
  });

  it("refuses a name already taken", () => {
    expect(() =>
      edit(AUTHORED, (doc) => {
        addAlternative(doc, "crunch");
      }),
    ).toThrow(/already has/);
  });
});

describe("through the real loader", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-alt-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const project = (node: Record<string, unknown>): string => {
    const p = join(dir, "song.k7");
    writeDoc(join(p, "project.k7x"), { project: { name: "song" } });
    writeDoc(join(dir, "_modules", "audio", "amp", "module.k7x"), {
      plugin: { type: "internal", name: "Chorus" },
      params: { Gain: 1, Tone: 5 },
    });
    writeNode(p, "ampli", node);
    writeNode(p, "gtr", { extends: "@meta/track", events: [] });
    writeDoc(join(p, "graph.k7x"), {
      modules: { gtr: ["ampli"], ampli: ["OUT"] },
    });
    return p;
  };

  it("reaches the graph as the chosen set, with the list beside it", () => {
    const p = project({
      extends: "@workspace/audio/amp",
      params: { Gain: 3 },
      alternative: "crunch",
      alternatives: [{ name: "crunch", params: { Gain: 9 } }],
    });
    const g = loadGraph(p);
    expect(g.modules.ampli.params).toEqual({ Gain: 9, Tone: 5 });
    // Both, so the node can draw a menu without re-reading the file.
    expect(g.modules.ampli.alternatives).toEqual(["1", "crunch"]);
    expect(g.modules.ampli.alternative).toBe("crunch");
    expect(g.warnings).toEqual([]);
  });

  it("says nothing about alternatives on a module that has none", () => {
    // No menu on a node with one set: a list of one is not a choice.
    const g = loadGraph(project({ extends: "@workspace/audio/amp" }));
    expect(g.modules.ampli.alternatives).toBeUndefined();
    expect(g.modules.ampli.alternative).toBeUndefined();
  });

  it("round-trips a switch written by the app", () => {
    const p = project({
      extends: "@workspace/audio/amp",
      params: { Gain: 3 },
      alternatives: [{ name: "crunch", params: { Gain: 9 } }],
    });
    wsEdit(join(p, "nodes", "ampli.k7x"), (doc) =>
      setAlternative(doc.at([]), "crunch"),
    );
    const resolved = resolveModuleMap(loadModules(p), loadModuleRefs(p));
    expect(resolved.ampli.params).toEqual({ Gain: 9, Tone: 5 });
  });
});

describe("a set that names ANOTHER module", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-altswap-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // Two modules to be, a strip to be a fader, and a lane: the node under test is written by each case.
  const project = (nodes: Record<string, Record<string, unknown>>): string => {
    const p = join(dir, "song.k7");
    writeDoc(join(p, "project.k7x"), { project: { name: "song" } });
    const lib = (path: string, value: Record<string, unknown>) =>
      writeDoc(join(dir, "_modules", path, "module.k7x"), value);
    lib("instruments/vst-wurli", {
      plugin: { type: "vst3", name: "Wurli V2" },
      params: { Tremolo: 0.3 },
    });
    lib("instruments/faust-wurli", {
      plugin: { type: "internal", name: "Faust" },
      params: { Bark: 0.5 },
    });
    lib("audio/strip", {
      plugin: { type: "internal", name: "Mixer" },
      params: { Volume: 0 },
    });
    for (const [name, value] of Object.entries(nodes))
      writeNode(p, name, value);
    writeDoc(join(p, "graph.k7x"), {
      modules: { keys: ["wurli"], wurli: ["OUT"] },
    });
    return p;
  };
  const LANE = { extends: "@meta/track", events: [] };
  const FAUST = "@workspace/instruments/faust-wurli";
  const resolved = (p: string) =>
    resolveModuleMap(loadModules(p), loadModuleRefs(p));

  it("becomes that module: its plugin and its params, none of the node's own", () => {
    const p = project({
      keys: LANE,
      wurli: {
        extends: "@workspace/instruments/vst-wurli",
        params: { Tremolo: 0.9 },
        alternative: "faust",
        alternatives: [
          { name: "faust", extends: FAUST, params: { Bark: 0.8 } },
        ],
      },
    });
    const w = resolved(p).wurli;
    expect(w.plugin).toEqual({ type: "internal", name: "Faust" });
    // The set's own params over the NEW module's — the VST's Tremolo belongs to set "1" and stays there.
    expect(w.params).toEqual({ Bark: 0.8 });
    // …and it is still THIS node, with the sets it can be switched between.
    expect(w.name).toBe("wurli");
    expect(w.alternatives).toBeDefined();
  });

  it("is the node's own module again on set 1", () => {
    const p = project({
      keys: LANE,
      wurli: {
        extends: "@workspace/instruments/vst-wurli",
        alternatives: [{ name: "faust", extends: FAUST }],
      },
    });
    expect(resolved(p).wurli.plugin).toEqual({
      type: "vst3",
      name: "Wurli V2",
    });
  });

  it("reaches the graph the compile builds, not only the resolver", () => {
    const p = project({
      keys: LANE,
      wurli: {
        extends: "@workspace/instruments/vst-wurli",
        alternative: "faust",
        alternatives: [{ name: "faust", extends: FAUST }],
      },
    });
    expect(loadGraph(p).modules.wurli.plugin).toEqual({
      type: "internal",
      name: "Faust",
    });
  });

  it("does not swap a LANE: the arrangement is built on it", () => {
    const p = project({
      keys: {
        ...LANE,
        alternative: "other",
        alternatives: [{ name: "other", extends: FAUST }],
      },
      wurli: { extends: "@workspace/instruments/vst-wurli" },
    });
    expect(resolved(p).keys.kind).toBe("track");
  });

  it("does not swap a lane's FADER: the mixer is built on it, though its settings still switch", () => {
    const p = project({
      keys: LANE,
      wurli: {
        extends: "@workspace/audio/strip",
        alternative: "other",
        alternatives: [
          { name: "other", extends: FAUST, params: { Volume: -6 } },
        ],
      },
    });
    const w = resolved(p).wurli;
    expect(w.plugin).toEqual({ type: "internal", name: "Mixer" });
    expect(w.params).toEqual({ Volume: -6 });
  });
});
