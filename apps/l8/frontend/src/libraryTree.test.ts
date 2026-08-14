import type { FileNode } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { isLibraryPath, libraryModuleRef, libraryTree } from "./libraryTree";

/** A folder node, spelled the way the file service serves one. */
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

/** A workspace tree holding the library submodule and a project beside it. */
const workspace = (modules: FileNode[]): FileNode[] => [
  dir("_libraries", "_libraries", [
    dir("modules", "_libraries/modules", modules),
  ]),
  dir("song.l8", "song.l8", []),
];

const reverb = dir("reverb", "_libraries/modules/audio/reverb", [
  file("module.yaml", "_libraries/modules/audio/reverb/module.yaml"),
]);

describe("libraryTree", () => {
  it("puts one namespace row above the catalogue", () => {
    const [root] = libraryTree(
      workspace([dir("audio", "_libraries/modules/audio", [reverb])]),
    );
    expect(root.name).toBe("@st0");
    expect(root.dir).toBe(true);
    expect(root.children?.map((n) => n.name)).toEqual(["audio"]);
  });

  it("keeps the real workspace paths, so the file service can read them", () => {
    const [root] = libraryTree(
      workspace([dir("audio", "_libraries/modules/audio", [reverb])]),
    );
    expect(root.path).toBe("_libraries/modules");
    const module = root.children?.[0].children?.[0];
    expect(module?.path).toBe("_libraries/modules/audio/reverb");
    expect(module?.children?.[0].path).toBe(
      "_libraries/modules/audio/reverb/module.yaml",
    );
  });

  it("passes the subtree through untouched — foldModules does the folding", () => {
    const audio = dir("audio", "_libraries/modules/audio", [reverb]);
    const [root] = libraryTree(workspace([audio]));
    expect(root.children?.[0]).toBe(audio);
  });

  it("draws nothing when the submodule is not mounted", () => {
    expect(libraryTree([dir("song.l8", "song.l8", [])])).toEqual([]);
  });

  it("draws nothing when the submodule is mounted but empty", () => {
    // An uninitialised submodule is an empty folder, and an empty folder is not a library.
    expect(libraryTree(workspace([]))).toEqual([]);
  });

  it("does not mistake a folder that merely starts the same way", () => {
    const decoy = dir("_librariesX", "_librariesX", [
      dir("modules", "_librariesX/modules", [reverb]),
    ]);
    expect(libraryTree([decoy])).toEqual([]);
  });
});

describe("libraryModuleRef", () => {
  it("names the module the way a chain does", () => {
    expect(
      libraryModuleRef("_libraries/modules/audio/reverb/module.yaml"),
    ).toBe("@st0/audio/reverb");
  });

  it("keeps the category segment", () => {
    expect(
      libraryModuleRef("_libraries/modules/audio/delay/tape-delay/ui.yaml"),
    ).toBe("@st0/audio/delay/tape-delay");
  });

  it("drops the last segment whatever it is spelt like", () => {
    // A module may be called `tape.delay`; the file is dropped by POSITION, never by looks.
    expect(
      libraryModuleRef("_libraries/modules/audio/tape.delay/module.yaml"),
    ).toBe("@st0/audio/tape.delay");
  });

  it("answers nothing for a project's own module", () => {
    expect(libraryModuleRef("modules/audio/reverb/module.yaml")).toBeNull();
  });

  it("answers nothing for the library's chains", () => {
    expect(
      libraryModuleRef("_libraries/chains/live/vocals/chains.yaml"),
    ).toBeNull();
  });

  it("answers nothing for a file that is not inside a module folder", () => {
    expect(libraryModuleRef("_libraries/modules/config.yaml")).toBeNull();
  });
});

describe("isLibraryPath", () => {
  it("tells a library module from the project's own", () => {
    expect(isLibraryPath("_libraries/modules/audio/reverb/module.yaml")).toBe(
      true,
    );
    expect(isLibraryPath("modules/audio/reverb/module.yaml")).toBe(false);
  });

  it("matches a whole segment, never a prefix", () => {
    expect(isLibraryPath("_librariesX/modules/a/module.yaml")).toBe(false);
  });
});
