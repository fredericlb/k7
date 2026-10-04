import { describe, expect, it } from "vitest";
import {
  compileWidgetsScript,
  hiddenWidgets,
  peakOf,
  TapHistory,
} from "./lcdScreen";

describe("compileWidgetsScript", () => {
  it("takes the draw functions a script RETURNS, by widget id", () => {
    const s = compileWidgetsScript("return { screen: (lcd) => lcd, n: 3 };");
    expect(s.error).toBeUndefined();
    expect(Object.keys(s.draws)).toEqual(["screen"]);
  });

  it("reads `export default` as the same return", () => {
    const s = compileWidgetsScript(
      "const k = 2;\nexport default { a() {}, b: () => k };",
    );
    expect(Object.keys(s.draws)).toEqual(["a", "b"]);
  });

  it("reports a syntax error instead of throwing", () => {
    const s = compileWidgetsScript("return { a: ( };");
    expect(s.draws).toEqual({});
    expect(s.error).toBeTruthy();
  });

  it("refuses a script that returns no object", () => {
    expect(compileWidgetsScript("const a = 1;").error).toMatch(/object/);
  });

  it("is nothing at all for an absent or blank script", () => {
    expect(compileWidgetsScript(undefined)).toEqual({
      draws: {},
      pointers: {},
    });
    expect(compileWidgetsScript("  \n")).toEqual({ draws: {}, pointers: {} });
  });

  it("takes an interactive screen's draw AND its pointer from `{ draw, pointer }`", () => {
    const s = compileWidgetsScript(
      "return { eq: { draw() {}, pointer() { return true; } }, still() {} };",
    );
    expect(Object.keys(s.draws)).toEqual(["eq", "still"]);
    expect(Object.keys(s.pointers)).toEqual(["eq"]);
  });

  it("compiles one text once", () => {
    const src = "return { x() {} };";
    expect(compileWidgetsScript(src)).toBe(compileWidgetsScript(src));
  });
});

describe("TapHistory", () => {
  it("folds each point to its peak and keeps only the newest", () => {
    const h = new TapHistory(3);
    h.push([
      { min: -0.5, max: 0.2 },
      { min: -0.1, max: 0.3 },
    ]);
    h.push([
      { min: 0, max: 0.9 },
      { min: -0.7, max: 0.1 },
    ]);
    expect(h.points).toEqual([0.3, 0.9, 0.7]);
  });

  it("peakOf is the larger swing either side of zero", () => {
    expect(peakOf({ min: -0.8, max: 0.1 })).toBe(0.8);
  });
});

describe("a panel's visible rule", () => {
  const AMP = `export default {
  visible: ({ ampModel }) => {
    if (!ampModel) return {};
    const n = ampModel.knobs;
    return { k1: n >= 1, k2: n >= 2, k3: n >= 3 };
  },
};`;
  const panel = (knobs?: number) => ({
    params: {},
    assets: {},
    ...(knobs === undefined
      ? {}
      : { ampModel: { kind: "aida-x" as const, knobs } }),
  });

  it("is a reserved key, never a screen", () => {
    const s = compileWidgetsScript(AMP);
    expect(s.draws).toEqual({});
    expect(typeof s.visible).toBe("function");
  });

  it("hides what it answers false for, and only that", () => {
    const s = compileWidgetsScript(AMP);
    expect([...hiddenWidgets(s, panel(1))].sort()).toEqual(["k2", "k3"]);
    expect([...hiddenWidgets(s, panel(3))]).toEqual([]);
    expect([...hiddenWidgets(s, panel(0))].sort()).toEqual(["k1", "k2", "k3"]);
    // No model read — the builder's preview — and every knob stays, to be laid out.
    expect([...hiddenWidgets(s, panel())]).toEqual([]);
  });

  it("hides nothing when it throws or has no rule", () => {
    const boom = compileWidgetsScript(
      "return { visible: () => { throw 1; } };",
    );
    expect([...hiddenWidgets(boom, panel(0))]).toEqual([]);
    const none = compileWidgetsScript("return { screen() {} };");
    expect([...hiddenWidgets(none, panel(0))]).toEqual([]);
  });
});
