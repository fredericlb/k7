import { describe, expect, it } from "vitest";
import {
  benchChainPath,
  benchProjectForChain,
  HAS_SCAFFOLD,
  launchUrl,
  PROJECT_SUFFIXES,
  projectApp,
  projectLabel,
  SCAFFOLDED_APPS,
} from "./projects.ts";

describe("projectApp", () => {
  it("reads the suffix", () => {
    expect(projectApp("mysong.l8")).toBe("l8");
    expect(projectApp("myset.m9")).toBe("m9");
    expect(projectApp("le clip.v1")).toBe("v1");
    expect(projectApp("session-2304.z0")).toBe("z0");
  });

  it("is null for a folder claiming no app", () => {
    for (const name of ["mysong", "songs", "mysong.l8.bak", "l8", "m9"])
      expect(projectApp(name), name).toBe(null);
  });

  it("refuses a bare suffix — `.l8` is a dotfolder, not a nameless project", () => {
    expect(projectApp(".l8")).toBe(null);
    expect(projectApp(".m9")).toBe(null);
    expect(projectApp(".v1")).toBe(null);
    expect(projectApp(".z0")).toBe(null);
  });

  it("reads `.v1` only as a final suffix, never as part of a name", () => {
    // The one suffix that is also an ordinary word in a folder name. `prise v1` is a take;
    // only the dot makes it a cut.
    expect(projectApp("prise v1")).toBe(null);
    expect(projectApp("v1")).toBe(null);
    expect(projectApp("prise v1.l8")).toBe("l8");
    expect(projectApp("prise v1.v1")).toBe("v1");
  });

  it("does not match another service's name", () => {
    // k7 owns no projects; a folder named for it is just a folder.
    expect(projectApp("show.k7")).toBe(null);
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
    expect(projectLabel("le clip.v1")).toBe("le clip");
  });
});

describe("launchUrl", () => {
  it("sends each app to its own service, under one origin", () => {
    const o = "https://studio.test";
    expect(launchUrl(o, "band", "winter.l8", "l8")).toBe(
      "https://studio.test/l8/band/winter.l8",
    );
    expect(launchUrl(o, "band", "live.m9", "m9")).toBe(
      "https://studio.test/m9/band/live.m9",
    );
    expect(launchUrl(o, "band", "le clip.v1", "v1")).toBe(
      "https://studio.test/v1/band/le%20clip.v1",
    );
  });

  it("keeps only the origin of whatever URL it is handed", () => {
    // Callers pass `window.location.href`, which carries a path of its own.
    expect(
      launchUrl("https://studio.test/projects?x=1", "b", "c.v1", "v1"),
    ).toBe("https://studio.test/v1/b/c.v1");
  });
});

describe("which apps can be CREATED", () => {
  it("is not the same set as the apps that own a folder kind", () => {
    // z0 owns `.z0` and has no scaffold. Offering it built a `.z0` holding an l8 song.
    expect(SCAFFOLDED_APPS).toEqual(["l8", "m9", "v1"]);
    expect(HAS_SCAFFOLD.z0).toBe(false);
  });

  it("answers for every app that owns a suffix", () => {
    // The Record is what makes a new ProjectApp fail to compile until someone decides.
    for (const app of Object.keys(PROJECT_SUFFIXES))
      expect(HAS_SCAFFOLD, app).toHaveProperty(app);
  });
});

describe("a chain opened on the bench", () => {
  it("is the catalogue path, and comes back as one", () => {
    const chain = "chains/blindtest/assourdissant/music";
    expect(benchProjectForChain(chain)).toBe(`${chain}.l8`);
    expect(benchChainPath(`${chain}.l8`)).toBe(chain);
  });

  it("is not the module bench, and the module bench is not one", () => {
    expect(benchChainPath("modules.l8")).toBeNull();
    expect(benchChainPath("chains.l8")).toBeNull(); // the family folder itself names no chain
  });

  it("refuses a path that would climb out of the médiathèque", () => {
    // This is what an ADDRESS says, and the machine joins it onto two roots — the médiathèque
    // and the workspace. A traversal accepted here would be a folder made outside both.
    expect(benchChainPath("chains/../../etc/passwd.l8")).toBeNull();
    expect(benchChainPath("chains/./x.l8")).toBeNull();
    expect(benchChainPath("chains//x.l8")).toBeNull();
    expect(benchChainPath("chains/..\\x.l8")).toBeNull();
  });
});
