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
    expect(projectApp("session-2304.z0")).toBe("z0");
  });

  it("no longer knows `.v1` or `.m9` — both are shapes of an l8 project now", () => {
    // Each suffix meant "this folder is ONLY one thing": only picture, only a set. Neither is
    // true any more. A `.l8` carries `video_tracks/` and a `viewport` surface, or `songs.yaml`
    // and a `turntables` surface — so the two kinds had nothing left to distinguish, and the
    // apps that opened them had nothing left to do. See @studio/song's PROJECT_SHAPES.
    expect(projectApp("le clip.v1")).toBe(null);
    expect(projectApp("prise v1.v1")).toBe(null);
    expect(projectApp("myset.m9")).toBe(null);
  });

  it("is null for a folder claiming no app", () => {
    for (const name of ["mysong", "songs", "mysong.l8.bak", "l8", "m9"])
      expect(projectApp(name), name).toBe(null);
  });

  it("refuses a bare suffix — `.l8` is a dotfolder, not a nameless project", () => {
    expect(projectApp(".l8")).toBe(null);
    expect(projectApp(".z0")).toBe(null);
  });

  it("reads a suffix only at the END, never as part of a name", () => {
    expect(projectApp("prise v1")).toBe(null);
    expect(projectApp("prise v1.l8")).toBe("l8");
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
    expect(projectLabel("live set.l8")).toBe("live set");
  });

  it("leaves a name that claims no app alone", () => {
    expect(projectLabel("mysong")).toBe("mysong");
  });

  it("keeps a dot that is part of the name", () => {
    expect(projectLabel("v1.2.l8")).toBe("v1.2");
  });
});

describe("launchUrl", () => {
  it("sends each app to its own service, under one origin", () => {
    const o = "https://st0.priv.frediver.se";
    expect(launchUrl(o, "band", "winter.l8", "l8")).toBe(
      "https://st0.priv.frediver.se/l8/band/winter.l8",
    );
    expect(launchUrl(o, "band", "partie.z0", "z0")).toBe(
      "https://st0.priv.frediver.se/z0/editor-v2/band/partie.z0",
    );
    expect(launchUrl(o, "band", "le clip.l8", "l8")).toBe(
      "https://st0.priv.frediver.se/l8/band/le%20clip.l8",
    );
  });

  it("keeps only the origin of whatever URL it is handed", () => {
    // Callers pass `window.location.href`, which carries a path of its own.
    expect(
      launchUrl("https://st0.priv.frediver.se/projects?x=1", "b", "c.l8", "l8"),
    ).toBe("https://st0.priv.frediver.se/l8/b/c.l8");
  });
});

describe("which apps can be CREATED", () => {
  it("is not the same set as the apps that own a folder kind", () => {
    // z0 owns `.z0` and has no scaffold. Offering it built a `.z0` holding an l8 song.
    expect(SCAFFOLDED_APPS).toEqual(["l8"]);
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
