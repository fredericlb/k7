import { describe, expect, it } from "vitest";
import { DOC_EXT, docPattern, isDocFile, stripDocExt } from "./docExt";

describe("docExt", () => {
  it("accepts .k7x, any case, and nothing else", () => {
    for (const n of ["a.k7x", "dir/b.K7x", "C.K7X"])
      expect(isDocFile(n)).toBe(true);
    for (const n of ["a.yaml", "a.yml", "a.json", "a.k7x.bak", "k7x", "a.k7"])
      expect(isDocFile(n)).toBe(false);
  });

  it("strips only the document extension", () => {
    expect(stripDocExt("intro.k7x")).toBe("intro");
    expect(stripDocExt("a/b.K7X")).toBe("a/b");
    expect(stripDocExt("intro.yaml")).toBe("intro.yaml");
    expect(stripDocExt("x.k7x.k7x")).toBe("x.k7x");
  });

  it("builds a pattern around the extension", () => {
    const re = docPattern("(^|/)curves/[^/]+");
    expect(re.test("p/curves/a.k7x")).toBe(true);
    expect(re.test("curves/a.K7X")).toBe(true);
    expect(re.test("curves/a.yaml")).toBe(false);
    expect(re.test("p/curves/x/a.k7x")).toBe(false);
    expect(docPattern("^clips/[^/]+", "").test("clips/a.K7X")).toBe(false);
    expect(DOC_EXT.flags).toBe("i");
  });
});
