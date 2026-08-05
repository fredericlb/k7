import { describe, expect, it } from "vitest";
import { projectApp, projectLabel } from "./projects.ts";

describe("projectApp", () => {
  it("reads the suffix", () => {
    expect(projectApp("mysong.l8")).toBe("l8");
    expect(projectApp("myset.m9")).toBe("m9");
  });

  it("is null for a folder claiming no app", () => {
    for (const name of ["mysong", "songs", "mysong.l8.bak", "l8", "m9"])
      expect(projectApp(name), name).toBe(null);
  });

  it("refuses a bare suffix — `.l8` is a dotfolder, not a nameless project", () => {
    expect(projectApp(".l8")).toBe(null);
    expect(projectApp(".m9")).toBe(null);
  });

  it("does not match another service's name", () => {
    // k7 and z0 own no projects; a folder named for one is just a folder.
    expect(projectApp("show.k7")).toBe(null);
    expect(projectApp("game.z0")).toBe(null);
  });

  it("is case-sensitive, like the folder names it reads", () => {
    expect(projectApp("mysong.L8")).toBe(null);
  });
});

describe("projectLabel", () => {
  it("takes the suffix off, which is what a project is called", () => {
    expect(projectLabel("mysong.l8")).toBe("mysong");
    expect(projectLabel("live set.m9")).toBe("live set");
  });

  it("leaves a name that claims no app alone", () => {
    expect(projectLabel("mysong")).toBe("mysong");
  });

  it("keeps a dot that is part of the name", () => {
    expect(projectLabel("v1.2.l8")).toBe("v1.2");
  });
});
