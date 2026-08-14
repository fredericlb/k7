import type { FileNode } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import {
  isLibraryPath,
  librariesOwned,
  libraryModuleRef,
  libraryTree,
  withoutPaths,
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

/** A module folder as the file service serves one: the folder, holding its files. */
const module = (at: string, name: string): FileNode =>
  dir(name, `${at}/${name}`, [
    file("module.yaml", `${at}/${name}/module.yaml`),
  ]);

/** `<at>/audio/<name>` — a module under its type folder, which is how every level files one. */
const audio = (at: string, name: string): FileNode =>
  dir("audio", `${at}/audio`, [module(`${at}/audio`, name)]);

const PROJECT = "01.danse.l8";

/** A workspace holding all three levels plus the project's own files. */
const workspace = (): FileNode[] => [
  dir("_libraries", "_libraries", [
    dir("modules", "_libraries/modules", [
      audio("_libraries/modules", "reverb"),
    ]),
    dir("chains", "_libraries/chains", []),
  ]),
  dir("_modules", "_modules", [audio("_modules", "tape-delay")]),
  dir(PROJECT, PROJECT, [
    dir("modules", `${PROJECT}/modules`, [
      audio(`${PROJECT}/modules`, "wobble"),
    ]),
    dir("clips", `${PROJECT}/clips`, []),
    file("chains.yaml", `${PROJECT}/chains.yaml`),
  ]),
];

describe("libraryTree", () => {
  it("draws a row per level, nearest first", () => {
    // Precedence order, the same one the loader resolves in: reading the tab top to bottom is
    // reading which module would win.
    expect(libraryTree(workspace(), PROJECT).map((n) => n.name)).toEqual([
      "@project",
      "@workspace",
      "@st0",
    ]);
  });

  it("points each row at the real folder", () => {
    const [project, ws, st0] = libraryTree(workspace(), PROJECT);
    expect(project.path).toBe(`${PROJECT}/modules`);
    // A workspace library holds its type folders directly; the account's holds families, and
    // `modules` is one of them.
    expect(ws.path).toBe("_modules");
    expect(st0.path).toBe("_libraries/modules");
  });

  it("passes each subtree through untouched — foldModules does the folding", () => {
    const tree = workspace();
    const projectModules = tree[2].children?.[0];
    const [project] = libraryTree(tree, PROJECT);
    expect(project.children).toBe(projectModules?.children);
  });

  it("keeps a module's own path, so a click can read and write it", () => {
    const [project] = libraryTree(workspace(), PROJECT);
    // Under its TYPE folder, which is where every level files a module.
    expect(project.children?.[0].children?.[0].path).toBe(
      `${PROJECT}/modules/audio/wobble`,
    );
  });

  it("skips a level with no folder", () => {
    const only = [dir("_modules", "_modules", [audio("_modules", "x")])];
    expect(libraryTree(only, PROJECT).map((n) => n.name)).toEqual([
      "@workspace",
    ]);
  });

  it("skips a level whose folder is empty", () => {
    // An empty heading would be a place to put something, and this tab is a view.
    const empty = [dir("_modules", "_modules", [])];
    expect(libraryTree(empty, PROJECT)).toEqual([]);
  });

  it("finds a project's modules at any depth", () => {
    const nested = [
      dir("band", "band", [
        dir("winter.l8", "band/winter.l8", [
          dir("modules", "band/winter.l8/modules", [
            audio("band/winter.l8/modules", "amp"),
          ]),
        ]),
      ]),
    ];
    expect(libraryTree(nested, "band/winter.l8").map((n) => n.name)).toEqual([
      "@project",
    ]);
  });

  it("takes a lone project's modules at the root", () => {
    // A repository that IS the project: the active project is ".", and its `modules/` is the
    // workspace's top level rather than a folder inside one.
    const lone = [dir("modules", "modules", [audio("modules", "amp")])];
    expect(libraryTree(lone, ".").map((n) => n.name)).toEqual(["@project"]);
  });

  it("does not mistake a folder that merely starts the same way", () => {
    const decoy = [
      dir("_librariesX", "_librariesX", [audio("_librariesX", "a")]),
    ];
    expect(libraryTree(decoy, PROJECT)).toEqual([]);
  });
});

describe("what the Project tab drops", () => {
  it("names every folder the Libraries tab took over", () => {
    expect(librariesOwned(PROJECT)).toEqual([
      "_libraries",
      `${PROJECT}/modules`,
      "_modules",
      "_libraries/modules",
    ]);
  });

  it("removes them at whatever depth they sit, and nothing else", () => {
    const left = withoutPaths(workspace(), librariesOwned(PROJECT));
    expect(left.map((n) => n.name)).toEqual([PROJECT]);
    // The project keeps everything that is not its module folder.
    expect(left[0].children?.map((n) => n.name)).toEqual([
      "clips",
      "chains.yaml",
    ]);
  });

  it("leaves ANOTHER project's modules alone", () => {
    // Only the ACTIVE project is drawn as `@project`, so only its folder has a second home.
    const two = [
      ...workspace(),
      dir("other.l8", "other.l8", [
        dir("modules", "other.l8/modules", [audio("other.l8/modules", "x")]),
      ]),
    ];
    const left = withoutPaths(two, librariesOwned(PROJECT));
    expect(left.find((n) => n.name === "other.l8")?.children?.[0].name).toBe(
      "modules",
    );
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
      libraryModuleRef(`${PROJECT}/modules/audio/reverb/module.yaml`),
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
    expect(isLibraryPath(`${PROJECT}/modules/audio/reverb/module.yaml`)).toBe(
      false,
    );
  });

  it("matches a whole segment, never a prefix", () => {
    expect(isLibraryPath("_librariesX/modules/a/module.yaml")).toBe(false);
  });
});
