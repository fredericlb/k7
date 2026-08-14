import type { FileNode, ModuleLibrary } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import {
  isLibraryPath,
  libraryModuleRef,
  libraryTree,
  readOnlyPaths,
  rootOf,
} from "./libraryTree";

const dir = (name: string, path: string, children: FileNode[]): FileNode => ({
  name,
  path,
  dir: true,
  children,
});
const file = (name: string, path: string): FileNode => ({
  name,
  path,
  dir: false,
  kind: "text",
});

/** `<at>/audio/<name>` — a module under its type folder, which is how every level files one. */
const audio = (at: string, name: string): FileNode =>
  dir("audio", `${at}/audio`, [
    dir(name, `${at}/audio/${name}`, [
      file("module.yaml", `${at}/audio/${name}/module.yaml`),
    ]),
  ]);

const lib = (
  ns: string,
  path: string,
  exists: boolean,
  nodes: FileNode[] = [],
): ModuleLibrary => ({ ns, path, exists, nodes });

/** What the file service answers for a project with all three levels present. */
const all = (): ModuleLibrary[] => [
  lib("project", "01.danse.l8/modules", true, [
    audio("01.danse.l8/modules", "wobble"),
  ]),
  lib("workspace", "_modules", true, [audio("_modules", "tape-delay")]),
  lib("st0", "_libraries/modules", true, [
    audio("_libraries/modules", "reverb"),
  ]),
];

describe("libraryTree", () => {
  it("draws a row per level, in the order it was given", () => {
    // The service answers nearest-first — the order the loader resolves in — and this does not
    // re-sort it: two places deciding precedence is how they come to disagree.
    expect(libraryTree(all()).map((n) => n.name)).toEqual([
      "@project",
      "@workspace",
      "@st0",
    ]);
  });

  it("points each row at the real folder", () => {
    const [project, ws, st0] = libraryTree(all());
    expect(project.path).toBe("01.danse.l8/modules");
    expect(ws.path).toBe("_modules");
    expect(st0.path).toBe("_libraries/modules");
  });

  it("passes each subtree through untouched — foldModules does the folding", () => {
    const answer = all();
    expect(libraryTree(answer)[0].children).toBe(answer[0].nodes);
  });

  it("keeps a module's own path, so a click can read and write it", () => {
    const [project] = libraryTree(all());
    expect(project.children?.[0].children?.[0].path).toBe(
      "01.danse.l8/modules/audio/wobble",
    );
  });

  it("draws @project and @workspace even with no folder yet", () => {
    // The placeholder: a level you can put a module in is a real answer, and the row's menu is
    // what puts one there. Hiding it would leave nowhere to start on a new project.
    const fresh = [
      lib("project", "01.danse.l8/modules", false),
      lib("workspace", "_modules", false),
    ];
    expect(libraryTree(fresh).map((n) => n.name)).toEqual([
      "@project",
      "@workspace",
    ]);
    expect(libraryTree(fresh)[0].children).toEqual([]);
  });

  it("draws an EMPTY level too — it is not the same as an absent one", () => {
    expect(
      libraryTree([lib("project", "p/modules", true, [])]).map((n) => n.name),
    ).toEqual(["@project"]);
  });

  it("hides @st0 when it is not mounted", () => {
    // The one level that is not a folder to fill in: it is a git submodule somebody has to
    // mount, so an empty row would be an offer nothing here can honour.
    const noSub = [
      lib("project", "p/modules", true, [audio("p/modules", "a")]),
      lib("st0", "_libraries/modules", false),
    ];
    expect(libraryTree(noSub).map((n) => n.name)).toEqual(["@project"]);
  });

  it("draws @st0 when it IS mounted but still empty", () => {
    const mounted = [lib("st0", "_libraries/modules", true, [])];
    expect(libraryTree(mounted).map((n) => n.name)).toEqual(["@st0"]);
  });
});

/** `@engine` as the service answers it: no folder, read-only, synthesised type groups. */
const engine = (): ModuleLibrary => ({
  ns: "engine",
  path: "",
  exists: true,
  readOnly: true,
  nodes: [
    dir("audio", "@engine/audio", [
      file("nam", "@engine/nam"),
      file("bitcrush", "@engine/bitcrush"),
    ]),
    dir("instruments", "@engine/instruments", [file("serum", "@engine/serum")]),
  ],
});

describe("@engine", () => {
  it("gets a row even though it has no folder", () => {
    const [row] = libraryTree([engine()]);
    expect(row.name).toBe("@engine");
    // Its own label stands in for the path: there is no folder to name it by.
    expect(row.path).toBe("@engine");
  });

  it("carries the real ref on the leaves, whatever the folder rows say", () => {
    // The type rows are synthesised — a ref is flat (`@engine/nam`) — so the LEAF is the only
    // thing whose path anything downstream should trust.
    const [row] = libraryTree([engine()]);
    expect(row.children?.[0].children?.map((n) => n.path)).toEqual([
      "@engine/nam",
      "@engine/bitcrush",
    ]);
  });

  it("freezes the whole level, rows and all", () => {
    const frozen = readOnlyPaths([engine(), ...all()]);
    expect(frozen.has("@engine")).toBe(true);
    expect(frozen.has("@engine/audio")).toBe(true);
    expect(frozen.has("@engine/nam")).toBe(true);
    // …and nothing of a writable level.
    expect(frozen.has("_modules")).toBe(false);
    expect(frozen.has("01.danse.l8/modules")).toBe(false);
  });
});

describe("rootOf — what a create resolves against", () => {
  it("finds the level a row belongs to, at any depth", () => {
    expect(rootOf(all(), "_modules")?.ns).toBe("workspace");
    expect(rootOf(all(), "_modules/audio")?.ns).toBe("workspace");
    expect(rootOf(all(), "_libraries/modules/audio/delay")?.ns).toBe("st0");
  });

  it("refuses a read-only level, so no menu opens on it", () => {
    const libs = [engine(), ...all()];
    expect(rootOf(libs, "@engine")).toBeNull();
    expect(rootOf(libs, "@engine/audio")).toBeNull();
  });

  it("refuses a path in no level at all", () => {
    expect(rootOf(all(), "01.danse.l8/clips")).toBeNull();
  });

  it("matches whole segments, never a prefix", () => {
    expect(rootOf(all(), "_modulesX/audio")).toBeNull();
  });
});

describe("libraryModuleRef", () => {
  it("names an account-library module the way a chain does", () => {
    expect(
      libraryModuleRef("_libraries/modules/audio/reverb/module.yaml"),
    ).toBe("@st0/audio/reverb");
  });

  it("names a workspace module too — it has no `modules/` inside it", () => {
    expect(libraryModuleRef("_modules/audio/tape-delay/module.yaml")).toBe(
      "@workspace/audio/tape-delay",
    );
  });

  it("keeps the category segment", () => {
    expect(
      libraryModuleRef("_libraries/modules/audio/delay/tape-delay/ui.yaml"),
    ).toBe("@st0/audio/delay/tape-delay");
  });

  it("drops the last segment whatever it is spelt like", () => {
    expect(
      libraryModuleRef("_libraries/modules/audio/tape.delay/module.yaml"),
    ).toBe("@st0/audio/tape.delay");
  });

  it("answers nothing for a project's own module", () => {
    // That one is `moduleKeyFromPath`'s: a bare `audio/reverb` is what a chain writes for it.
    expect(
      libraryModuleRef("01.danse.l8/modules/audio/reverb/module.yaml"),
    ).toBeNull();
  });

  it("answers nothing for the library's chains", () => {
    expect(
      libraryModuleRef("_libraries/chains/live/vocals/chains.yaml"),
    ).toBeNull();
  });
});

describe("isLibraryPath", () => {
  it("is true only for the ACCOUNT's library", () => {
    // `_modules` is shared too, but a save aimed at it forks into the project — it has a way
    // back already and needs no gate in front of it.
    expect(isLibraryPath("_libraries/modules/audio/reverb/module.yaml")).toBe(
      true,
    );
    expect(isLibraryPath("_modules/audio/reverb/module.yaml")).toBe(false);
    expect(isLibraryPath("01.danse.l8/modules/audio/reverb/module.yaml")).toBe(
      false,
    );
  });

  it("matches a whole segment, never a prefix", () => {
    expect(isLibraryPath("_librariesX/modules/a/module.yaml")).toBe(false);
  });
});
