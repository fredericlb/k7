import { describe, expect, it } from "vitest";
import { DOC_EXT, docPattern, isDocFile, stripDocExt } from "./docExt";

describe("docExt", () => {
  it("accepts both formats, any case", () => {
    for (const n of ["a.yaml", "a.yml", "a.k7x", "dir/b.YAML", "C.K7X"])
      expect(isDocFile(n)).toBe(true);
    for (const n of ["a.json", "a.yaml.bak", "yaml", "a.k7", "a.vstpreset"])
      expect(isDocFile(n)).toBe(false);
  });

  it("strips only the document extension", () => {
    expect(stripDocExt("intro.yaml")).toBe("intro");
    expect(stripDocExt("intro.k7x")).toBe("intro");
    expect(stripDocExt("a/b.yml")).toBe("a/b");
    expect(stripDocExt("intro.wav")).toBe("intro.wav");
    expect(stripDocExt("x.yaml.yaml")).toBe("x.yaml");
  });

  it("builds a pattern around the extension", () => {
    const re = docPattern("(^|/)curves/[^/]+");
    expect(re.test("p/curves/a.k7x")).toBe(true);
    expect(re.test("curves/a.YAML")).toBe(true);
    expect(re.test("p/curves/x/a.yaml")).toBe(false);
    expect(docPattern("^clips/[^/]+", "").test("clips/a.YAML")).toBe(false);
    expect(DOC_EXT.flags).toBe("i");
  });
});
