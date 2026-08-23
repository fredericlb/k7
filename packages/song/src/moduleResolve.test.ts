import { describe, expect, it } from "vitest";
import {
  mergeAuthored,
  type ResolvedModule,
  resolvedRack,
  resolvedType,
  resolvedUI,
  resolveModule,
  resolveModuleMap,
} from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";

// The one answer to "what does this module run with?", after four helpers and three copies drifted.

// A LoadedModule without the loader — the two derived fields, and nothing else.
const mod = (m: Partial<LoadedModule>): LoadedModule =>
  ({ kind: "plugin", inputs: [], ...m }) as LoadedModule;
const res = (m: Partial<LoadedModule>): ResolvedModule =>
  mod(m) as ResolvedModule;

describe("resolvedType", () => {
  it("is plugin unless the module says rack", () => {
    expect(resolvedType(undefined)).toBe("plugin");
    expect(resolvedType(res({}))).toBe("plugin");
    expect(resolvedType(res({ type: "rack" }))).toBe("rack");
  });

  it("reads what the module INHERITED, since it is resolved", () => {
    const byRef = { "@library/kit": mod({ type: "rack" }) };
    expect(
      resolvedType(resolveModule(mod({ extends: "@library/kit" }), byRef)),
    ).toBe("rack");
    // …and a child that states its own still wins.
    const own = mod({ extends: "@library/kit", type: "plugin" });
    expect(resolvedType(resolveModule(own, byRef))).toBe("plugin");
  });
});

describe("resolvedRack", () => {
  const base = mod({
    rack: { rack_type: "samples", symbols: { BD: { note: 36, clip: "kick" } } },
  });
  const byRef = { "@library/kit": base };
  const child = (rack: unknown) =>
    resolveModule(mod({ extends: "@library/kit", rack } as never), byRef);

  it("merges the module's symbols over its base's", () => {
    expect(
      resolvedRack(child({ symbols: { HH: { note: 42, clip: "hat" } } }))
        .symbols,
    ).toEqual({
      BD: { note: 36, clip: "kick" },
      HH: { note: 42, clip: "hat" },
    });
  });

  it("lets the module win on a symbol they share", () => {
    expect(
      resolvedRack(child({ symbols: { BD: { note: 35, clip: "kick2" } } }))
        .symbols,
    ).toEqual({ BD: { note: 35, clip: "kick2" } });
  });

  it("inherits the flavour and the shared source", () => {
    const slice = {
      "@library/loop": mod({
        rack: {
          rack_type: "slice",
          source: "loop",
          symbols: { A: { note: 60, from: 0, to: 0.5 } },
        },
      } as never),
    };
    const r = resolvedRack(
      resolveModule(mod({ extends: "@library/loop" }), slice),
    );
    expect(r.rackType).toBe("slice");
    expect(r.source).toBe("loop");
    expect(r.symbols.A).toEqual({ note: 60, from: 0, to: 0.5 });
  });

  it("answers an empty samples rack for a module that has none", () => {
    expect(resolvedRack(undefined)).toEqual({
      rackType: "samples",
      source: undefined,
      symbols: {},
    });
  });
});

describe("resolvedUI", () => {
  it("is undefined when the module shows nothing", () => {
    expect(resolvedUI(undefined)).toBeUndefined();
    expect(resolvedUI(res({}))).toBeUndefined();
  });

  it("merges widgets per id and lets the child's grid win", () => {
    const byRef = {
      "@library/amp": mod({
        ui: {
          cols: 2,
          rows: 2,
          widgets: { a: { type: "knob", col: 0, row: 0, label: "BP" } },
        },
      }),
    };
    const ui = resolvedUI(
      resolveModule(
        mod({
          extends: "@library/amp",
          ui: {
            cols: 3,
            rows: 1,
            widgets: {
              a: { type: "knob", col: 1, row: 1, label: "OWN" },
              b: { type: "toggle", col: 0, row: 1, hidden: true },
            },
          },
        }),
        byRef,
      ),
    );
    expect(ui?.cols).toBe(3);
    expect(ui?.rows).toBe(1);
    expect(ui?.widgets.a.label).toBe("OWN"); // restated WHOLE, never patched
    expect(ui?.widgets.b).toBeUndefined(); // hidden is a wire detail, dropped here
  });
});

describe("resolveModule", () => {
  it("merges params per key, deepest ancestor first", () => {
    // Three levels: the bug this replaces resolved only one, so `a` was lost.
    const byRef = {
      "@library/a": mod({ params: { a: 1, b: 2, c: 3 } }),
      "@library/b": mod({ extends: "@library/a", params: { b: 20 } }),
    };
    const m = resolveModule(
      mod({ extends: "@library/b", params: { c: 30 } }),
      byRef,
    );
    expect(m.params).toEqual({ a: 1, b: 20, c: 30 });
  });

  it("keeps an inherited asset the loader wrote as undefined on the child", () => {
    // Decoration writes those keys at undefined, so a plain spread had the child erase its parent's.
    const byRef = {
      "@st0/audio/amp": mod({
        nam: "/mods/amp/assets/jcm800.nam",
        preset: "/mods/amp/p.vstpreset",
        assets: { nam: "jcm800.nam" },
      }),
    };
    const child = mod({
      extends: "@st0/audio/amp",
      nam: undefined,
      preset: undefined,
    });
    const m = resolveModule(child, byRef);
    expect(m.nam).toBe("/mods/amp/assets/jcm800.nam");
    expect(m.preset).toBe("/mods/amp/p.vstpreset");
    expect(m.assets).toEqual({ nam: "jcm800.nam" });
  });

  it("never inherits what says WHERE the module lives", () => {
    // Its icon, ports and node name come from its OWN folder, not from its base's.
    const byRef = {
      "@library/synth": mod({
        kind: "plugin",
        category: "instruments",
        inputs: [{ name: "midi", type: "midi" }],
      }),
    };
    const m = resolveModule(
      mod({
        extends: "@library/synth",
        category: "audio",
        inputs: [{ name: "in", type: "audio" }],
      }),
      byRef,
    );
    expect(m.category).toBe("audio");
    expect(m.inputs).toEqual([{ name: "in", type: "audio" }]);
  });

  it("stops at a cycle rather than throwing", () => {
    // A bad `extends` costs the inheritance, not the project — validate() reports it.
    const byRef: Record<string, LoadedModule> = {
      a: mod({ extends: "b", params: { x: 1 } }),
      b: mod({ extends: "a", params: { y: 2 } }),
    };
    expect(resolveModuleMap(byRef).a.params).toEqual({ x: 1, y: 2 });
  });

  it("leaves a module whose base does not exist alone", () => {
    const m = resolveModule(
      mod({ extends: "@library/gone", params: { a: 1 } }),
      {},
    );
    expect(m.params).toEqual({ a: 1 });
    expect(m.extends).toBe("@library/gone"); // still reported as dangling downstream
  });
});

describe("mergeAuthored", () => {
  it("takes the child's value, including one it sets to a falsy", () => {
    // Skipping `undefined` must not skip 0: silencing an inherited 3 dB gain has to mean it.
    expect(mergeAuthored({ gain: 3 }, { gain: 0 }).gain).toBe(0);
    expect(mergeAuthored({ source: "loop" }, { source: "" }).source).toBe("");
  });
});
