// A module's ALTERNATIVES: named attribute sets it can be switched between. What is pinned here
// is the MERGE — an alternative is an ordinary extender of its own module, so `params` merge per
// entry and a list replaces outright — and the order against `extends`, which is the one thing a
// reader cannot guess. See docs/alternatives.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const AUTHORED = `# the amp
extends: "@workspace/audio/amp"
params: { Gain: 3, Tone: 5 }
alternatives:
  - name: crunch
    params: { Gain: 9 }
`;

  it("switches by ADDING one line, keeping every other byte", () => {
    const after = setAlternative(AUTHORED, "crunch");
    expect(after).toContain("alternative: crunch");
    // Take the selection back out and the file is what it was, comments and key order included.
    expect(after.replace("alternative: crunch\n", "")).toBe(AUTHORED);
  });

  it("clears the key going back to the first, rather than writing `alternative: 1`", () => {
    const on = setAlternative(AUTHORED, "crunch");
    expect(setAlternative(on, "1")).toBe(AUTHORED);
  });

  it("refuses a name the module does not have", () => {
    expect(() => setAlternative(AUTHORED, "ghost")).toThrow(/no alternative/);
  });

  it("adds an EMPTY one and switches to it — a set states only what it changes", () => {
    const { text, name } = addAlternative(AUTHORED, "clean");
    expect(name).toBe("clean");
    expect(text).toContain("alternative: clean");
    // Empty, so it plays the module as authored until you change something.
    expect(text).toMatch(/- name: clean\s*\n/);
  });

  it("numbers an unnamed one after the last, counting the first", () => {
    expect(addAlternative(AUTHORED).name).toBe("3");
  });

  it("copies the set that is CURRENTLY on, not the module's own", () => {
    const on = setAlternative(AUTHORED, "crunch");
    const { text } = addAlternative(on, "crunchier", { copy: true });
    // crunch's OWN fields: baking Tone in would cut the copy off from later edits to the module.
    expect(text).toContain("Gain: 9");
    expect(text).not.toMatch(/name: crunchier[\s\S]*Tone/);
  });

  it("refuses a name already taken", () => {
    expect(() => addAlternative(AUTHORED, "crunch")).toThrow(/already has/);
  });
});

describe("through the real loader", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-alt-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const project = (node: string): string => {
    const p = join(dir, "song.st0");
    mkdirSync(join(p, "nodes"), { recursive: true });
    mkdirSync(join(dir, "_modules", "audio", "amp"), { recursive: true });
    writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
    writeFileSync(
      join(dir, "_modules", "audio", "amp", "module.yaml"),
      "plugin: { type: internal, name: Chorus }\nparams: { Gain: 1, Tone: 5 }\n",
    );
    writeFileSync(join(p, "nodes", "ampli.yaml"), node);
    writeFileSync(
      join(p, "nodes", "gtr.yaml"),
      'extends: "@meta/track"\nevents: []\n',
    );
    writeFileSync(
      join(p, "graph.yaml"),
      "modules:\n  gtr: [ ampli ]\n  ampli: [ OUT ]\n",
    );
    return p;
  };

  it("reaches the graph as the chosen set, with the list beside it", () => {
    const p = project(
      'extends: "@workspace/audio/amp"\nparams: { Gain: 3 }\n' +
        "alternative: crunch\nalternatives:\n  - name: crunch\n    params: { Gain: 9 }\n",
    );
    const g = loadGraph(p);
    expect(g.modules.ampli.params).toEqual({ Gain: 9, Tone: 5 });
    // Both, so the node can draw a menu without re-reading the file.
    expect(g.modules.ampli.alternatives).toEqual(["1", "crunch"]);
    expect(g.modules.ampli.alternative).toBe("crunch");
    expect(g.warnings).toEqual([]);
  });

  it("says nothing about alternatives on a module that has none", () => {
    // No menu on a node with one set: a list of one is not a choice.
    const g = loadGraph(project('extends: "@workspace/audio/amp"\n'));
    expect(g.modules.ampli.alternatives).toBeUndefined();
    expect(g.modules.ampli.alternative).toBeUndefined();
  });

  it("round-trips a switch written by the app", () => {
    const p = project(
      'extends: "@workspace/audio/amp"\nparams: { Gain: 3 }\n' +
        "alternatives:\n  - name: crunch\n    params: { Gain: 9 }\n",
    );
    const file = join(p, "nodes", "ampli.yaml");
    writeFileSync(
      file,
      setAlternative(readFileSync(file, "utf8"), "crunch"),
      "utf8",
    );
    const resolved = resolveModuleMap(loadModules(p), loadModuleRefs(p));
    expect(resolved.ampli.params).toEqual({ Gain: 9, Tone: 5 });
  });
});
