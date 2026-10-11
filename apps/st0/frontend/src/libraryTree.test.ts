import type { FileNode, ModuleLibrary } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import {
  fileFolderOf,
  isChainFile,
  isLibraryPath,
  libraryModuleRef,
  libraryOfPath,
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

/** What the file service answers for a project with both levels present. */
const all = (): ModuleLibrary[] => [
  lib("workspace", "_modules", true, [audio("_modules", "tape-delay")]),
  lib("st0", "_libraries/st0/modules", true, [
    audio("_libraries/st0/modules", "reverb"),
  ]),
];

describe("libraryTree", () => {
  it("draws a row per level, in the order it was given", () => {
    // The service answers nearest-first and this does not re-sort it: two places deciding precedence is how they come to disagree.
    expect(libraryTree(all()).map((n) => n.name)).toEqual([
      "@workspace",
      "@st0",
    ]);
  });

  it("points each row at the real folder", () => {
    const [ws, st0] = libraryTree(all());
    expect(ws.path).toBe("_modules");
    // `@st0` is the REPOSITORY, whose `modules/` is the level — see the repository block below.
    expect(st0.path).toBe("_libraries/st0");
    expect(st0.children?.[0].path).toBe("_libraries/st0/modules");
  });

  it("passes each subtree through untouched — foldModules does the folding", () => {
    const answer = all();
    expect(libraryTree(answer)[0].children).toBe(answer[0].nodes);
  });

  it("keeps a module's own path, so a click can read and write it", () => {
    const [ws] = libraryTree(all());
    expect(ws.children?.[0].children?.[0].path).toBe(
      "_modules/audio/tape-delay",
    );
  });

  it("draws @workspace even with no folder yet", () => {
    // The placeholder: a level you can put a module in is a real answer, and hiding it would leave nowhere to start on a new project.
    const fresh = [lib("workspace", "_modules", false)];
    expect(libraryTree(fresh).map((n) => n.name)).toEqual(["@workspace"]);
    expect(libraryTree(fresh)[0].children).toEqual([]);
  });

  it("draws an EMPTY level too — it is not the same as an absent one", () => {
    expect(
      libraryTree([lib("workspace", "_modules", true, [])]).map((n) => n.name),
    ).toEqual(["@workspace"]);
  });

  it("draws a library with no `modules/` yet — the service lists only the ones it cloned", () => {
    const noModules = [
      lib("workspace", "_modules", true, [audio("_modules", "a")]),
      lib("st0", "_libraries/st0/modules", false),
    ];
    expect(libraryTree(noModules).map((n) => n.name)).toEqual([
      "@workspace",
      "@st0",
    ]);
  });

  it("draws every library the account has, each as its own repository row", () => {
    const two = [
      lib("drums", "_libraries/drums/modules", true, []),
      lib("st0", "_libraries/st0/modules", true, []),
    ];
    expect(libraryTree(two).map((n) => [n.name, n.path])).toEqual([
      ["@drums", "_libraries/drums"],
      ["@st0", "_libraries/st0"],
    ]);
  });

  it("draws @st0 when it IS cloned but still empty", () => {
    const mounted = [lib("st0", "_libraries/st0/modules", true, [])];
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
    // The type rows are synthesised — a ref is flat — so the LEAF is the only thing whose path anything downstream should trust.
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
    expect(frozen.has("_libraries/st0/modules")).toBe(false);
  });
});

describe("rootOf — what a create resolves against", () => {
  it("finds the level a row belongs to, at any depth", () => {
    expect(rootOf(all(), "_modules")?.ns).toBe("workspace");
    expect(rootOf(all(), "_modules/audio")?.ns).toBe("workspace");
    expect(rootOf(all(), "_libraries/st0/modules/audio/delay")?.ns).toBe("st0");
  });

  it("refuses a read-only level, so no menu opens on it", () => {
    const libs = [engine(), ...all()];
    expect(rootOf(libs, "@engine")).toBeNull();
    expect(rootOf(libs, "@engine/audio")).toBeNull();
  });

  it("refuses a path in no level at all", () => {
    expect(rootOf(all(), "song.st0/clips")).toBeNull();
  });

  it("matches whole segments, never a prefix", () => {
    expect(rootOf(all(), "_modulesX/audio")).toBeNull();
  });
});

describe("libraryModuleRef", () => {
  it("names an account-library module the way a chain does", () => {
    expect(
      libraryModuleRef("_libraries/st0/modules/audio/reverb/module.yaml"),
    ).toBe("@st0/audio/reverb");
  });

  it("names a workspace module too — it has no `modules/` inside it", () => {
    expect(libraryModuleRef("_modules/audio/tape-delay/module.yaml")).toBe(
      "@workspace/audio/tape-delay",
    );
  });

  it("keeps the category segment", () => {
    expect(
      libraryModuleRef("_libraries/st0/modules/audio/delay/tape-delay/ui.yaml"),
    ).toBe("@st0/audio/delay/tape-delay");
  });

  it("drops the last segment whatever it is spelt like", () => {
    expect(
      libraryModuleRef("_libraries/st0/modules/audio/tape.delay/module.yaml"),
    ).toBe("@st0/audio/tape.delay");
  });

  it("answers nothing for a path in neither shared level", () => {
    // A project's own files are never a module ref — a module lives at `@workspace` or in a library now.
    expect(libraryModuleRef("song.st0/nodes/lead.yaml")).toBeNull();
  });

  it("names a module of ANOTHER library by that library", () => {
    expect(
      libraryModuleRef("_libraries/drums/modules/audio/kick/module.yaml"),
    ).toBe("@drums/audio/kick");
  });

  it("answers nothing for the library's chains", () => {
    expect(
      libraryModuleRef("_libraries/st0/chains/live/vocals/graph.yaml"),
    ).toBeNull();
  });
});

describe("libraryOfPath — which library a Save publishes", () => {
  it("reads the library off a `_libraries/<name>/…` path", () => {
    expect(libraryOfPath("_libraries/st0/modules/audio/x/module.yaml")).toBe(
      "st0",
    );
    expect(libraryOfPath("_libraries/drums/chains/kit/graph.yaml")).toBe(
      "drums",
    );
  });

  it("answers nothing outside the libraries, or for a name no library could have", () => {
    expect(libraryOfPath("_modules/audio/x/module.yaml")).toBeNull();
    expect(libraryOfPath("_libraries/engine/modules/x.yaml")).toBeNull();
    expect(libraryOfPath("_libraries")).toBeNull();
  });
});

describe("isLibraryPath", () => {
  it("is true only for the ACCOUNT's library", () => {
    // `_modules` is shared too, but a save aimed at it forks into the workspace: it has a way back already and needs no gate.
    expect(
      isLibraryPath("_libraries/st0/modules/audio/reverb/module.yaml"),
    ).toBe(true);
    expect(isLibraryPath("_modules/audio/reverb/module.yaml")).toBe(false);
    expect(isLibraryPath("song.st0/nodes/lead.yaml")).toBe(false);
  });

  it("matches a whole segment, never a prefix", () => {
    expect(isLibraryPath("_librariesX/modules/a/module.yaml")).toBe(false);
  });
});

// A library is a REPOSITORY, drawn as it is on disk: `modules/`, `chains/` and `assemblies/`
// side by side. It used to be `modules/` drawn AS `@st0`, with the chains beside it as `@st0/chains` —
// two siblings that read as a folder and its child.
describe("the library repository row", () => {
  const LEVELS = [lib("st0", "_libraries/st0/modules", true, [])];
  const CHAINS = [
    {
      ref: "@st0/process/normalize",
      path: "_libraries/st0/chains/process/normalize",
      nodes: ["normalize.yaml"],
    },
    {
      ref: "@st0/live/vocals",
      path: "_libraries/st0/chains/live/vocals",
      nodes: [],
    },
  ];
  const ASSEMBLIES = [
    {
      ref: "@st0/band/four-piece",
      path: "_libraries/st0/assemblies/band/four-piece",
      file: "_libraries/st0/assemblies/band/four-piece/assembly.yaml",
    },
  ];
  const repo = () => libraryTree(LEVELS, CHAINS, ASSEMBLIES)[0];

  it("is ONE row, the repository, with its families under it — its file folders included", () => {
    expect(libraryTree(LEVELS, CHAINS, ASSEMBLIES)).toHaveLength(1);
    expect(repo().name).toBe("@st0");
    expect(repo().path).toBe("_libraries/st0");
    expect(repo().children?.map((c) => [c.name, c.path])).toEqual([
      ["modules", "_libraries/st0/modules"],
      ["chains", "_libraries/st0/chains"],
      ["assemblies", "_libraries/st0/assemblies"],
      ["samples", "_libraries/st0/samples"],
      ["irs", "_libraries/st0/irs"],
      ["wavetables", "_libraries/st0/wavetables"],
      ["models", "_libraries/st0/models"],
    ]);
  });

  it("keeps the module level's own path and subtree, which 'New module…' resolves against", () => {
    const answer = [
      lib("st0", "_libraries/st0/modules", true, [
        audio("_libraries/st0/modules", "reverb"),
      ]),
    ];
    const modules = libraryTree(answer)[0].children?.[0];
    expect(modules?.children).toBe(answer[0].nodes);
    expect(rootOf(answer, modules?.path ?? "")?.ns).toBe("st0");
    // …and the repository row is no level: nothing is created at its root.
    expect(rootOf(answer, "_libraries/st0")).toBeNull();
  });

  it("draws each chain as a FOLDER holding its nodes, at their real paths", () => {
    const chains = repo().children?.[1];
    expect(chains?.children?.map((c) => c.name)).toEqual([
      "process/normalize",
      "live/vocals",
    ]);
    // A chain is a folder on disk — a graph and the nodes it names — and the tree says so rather than hiding half of it.
    expect(chains?.children?.every((c) => c.dir)).toBe(true);
    const first = chains?.children?.[0];
    expect(first?.path).toBe("_libraries/st0/chains/process/normalize");
    // The path is what tells a node's row from its chain's when one is clicked, so it is the real one and not a label.
    expect(first?.children?.map((n) => [n.name, n.path, n.dir])).toEqual([
      [
        "normalize.yaml",
        "_libraries/st0/chains/process/normalize/nodes/normalize.yaml",
        false,
      ],
    ]);
    // One node away from having some; a leaf row would say it could never.
    expect(chains?.children?.[1].dir).toBe(true);
    expect(chains?.children?.[1].children).toEqual([]);
  });

  it("draws a chain FILE as a leaf at its file — its nodes are inside it", () => {
    const rows = libraryTree(LEVELS, [
      {
        ref: "@st0/stems",
        path: "_libraries/st0/chains/stems.yaml",
        nodes: [],
      },
    ])[0].children?.[1].children;
    expect(rows?.map((c) => [c.name, c.path, c.dir, c.children])).toEqual([
      ["stems", "_libraries/st0/chains/stems.yaml", false, undefined],
    ]);
    expect(isChainFile("_libraries/st0/chains/stems.yaml")).toBe(true);
    expect(isChainFile("_libraries/st0/chains/process/normalize")).toBe(false);
  });

  it("draws each assembly template as a leaf at its folder", () => {
    expect(
      repo().children?.[2].children?.map((a) => [a.name, a.path, a.dir]),
    ).toEqual([
      ["band/four-piece", "_libraries/st0/assemblies/band/four-piece", false],
    ]);
  });

  it("still draws every family when a library holds no chain, template or sound yet", () => {
    // They are the repository's layout, not a list that happens to be empty — and a sound folder is where a drop lands.
    expect(libraryTree(LEVELS)[0].children?.map((c) => c.name)).toEqual([
      "modules",
      "chains",
      "assemblies",
      "samples",
      "irs",
      "wavetables",
      "models",
    ]);
  });

  it("takes a drop only on a library's samples/, irs/, wavetables/ or models/, or inside one, and says which", () => {
    expect(fileFolderOf("_libraries/st0/samples")).toBe("samples");
    expect(fileFolderOf("_libraries/st0/wavetables/akwf")).toBe("wavetables");
    expect(fileFolderOf("_libraries/st0/irs/fender")).toBe("irs");
    expect(fileFolderOf("_libraries/st0/models/guitarml proteus")).toBe(
      "models",
    );
    expect(fileFolderOf("_libraries/st0/modules")).toBeNull();
    expect(fileFolderOf("song.st0/samples")).toBeNull();
  });

  it("files each chain and template under ITS library's row, named within it", () => {
    const tree = libraryTree(
      [...LEVELS, lib("drums", "_libraries/drums/modules", true, [])],
      [
        ...CHAINS,
        { ref: "@drums/kit/room", path: "_libraries/drums/chains/kit/room" },
      ],
      ASSEMBLIES,
    );
    const chainsOf = (row: FileNode) =>
      row.children?.[1].children?.map((c) => c.name);
    expect(chainsOf(tree[0])).toEqual(["process/normalize", "live/vocals"]);
    expect(chainsOf(tree[1])).toEqual(["kit/room"]);
    expect(tree[1].children?.[2].children).toEqual([]);
  });
});
