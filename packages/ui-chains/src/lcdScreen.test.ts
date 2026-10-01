import { describe, expect, it } from "vitest";
import { compileWidgetsScript, peakOf, TapHistory } from "./lcdScreen";

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
