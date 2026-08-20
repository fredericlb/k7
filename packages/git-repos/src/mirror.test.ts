import { describe, expect, it } from "vitest";
import { buildTree, projectDirs } from "./mirror.ts";

const FILES = [
  "README.md",
  "songs/first.st0/project.yaml",
  "songs/first.st0/tracks/bass.yaml",
  "songs/first.st0/audio/kick.wav",
  "songs/live.z0/chains.yaml",
  // Picture lives in a SONG — one folder, two compiles — so a lane file changes nothing here:
  // the folder is a `.st0` and the suffix is still the whole rule.
  "clips/le clip.st0/project.yaml",
  "clips/le clip.st0/video_tracks/main.yaml",
  "songs/notes.txt",
  "deep/a/b/c.st0/project.yaml",
  // A folder with a project file but NO suffix is not a project any more — the name decides.
  "plain/project.yaml",
  "node_modules/pkg/index.js",
  ".github/workflows/ci.yml",
];

describe("projectDirs", () => {
  it("finds a project by its suffix, at any depth, and says which app", () => {
    expect(projectDirs(FILES)).toEqual(
      new Map([
        ["songs/first.st0", "st0"],
        ["songs/live.z0", "z0"],
        ["clips/le clip.st0", "st0"],
        ["deep/a/b/c.st0", "st0"],
      ]),
    );
  });

  it("does not care what is inside", () => {
    // No project.yaml anywhere here: the name is the whole rule.
    expect(projectDirs(["set.z0/notes.txt"])).toEqual(
      new Map([["set.z0", "z0"]]),
    );
  });

  it("ignores a FILE that ends in the suffix — only folders are projects", () => {
    expect(projectDirs(["notes.st0", "a/thing.z0"])).toEqual(new Map());
  });

  it("refuses a bare suffix as a name of its own", () => {
    // `.st0/` is a dotfolder, which the tree hides anyway; it names no project either.
    expect(projectDirs([".st0/project.yaml"])).toEqual(new Map());
  });

  it("reports a project nested inside another, rather than hiding it", () => {
    expect(projectDirs(["song.st0/set.z0/chains.yaml"])).toEqual(
      new Map([
        ["song.st0", "st0"],
        ["song.st0/set.z0", "z0"],
      ]),
    );
  });
});

describe("buildTree", () => {
  const tree = buildTree(FILES, projectDirs(FILES));
  const at = (path: string) => {
    const walk = (
      nodes: typeof tree,
      segs: string[],
    ): (typeof tree)[0] | undefined => {
      const found = nodes.find((n) => n.name === segs[0]);
      if (!found || segs.length === 1) return found;
      return walk(found.children ?? [], segs.slice(1));
    };
    return walk(tree, path.split("/"));
  };

  it("marks the project folders and carries the app on each", () => {
    expect(at("songs/first.st0")).toMatchObject({ project: true, app: "st0" });
    expect(at("songs/live.z0")).toMatchObject({ project: true, app: "z0" });
    expect(at("deep/a/b/c.st0")?.app).toBe("st0");
  });

  it("leaves an unsuffixed folder alone, project file or not", () => {
    expect(at("plain")?.project).toBeUndefined();
    expect(at("plain")?.app).toBeUndefined();
    expect(at("songs")?.project).toBeUndefined();
  });

  it("drops dotfolders and node_modules with their whole subtree", () => {
    expect(at("node_modules")).toBeUndefined();
    expect(at(".github")).toBeUndefined();
  });

  it("sorts folders before files, then by name", () => {
    expect(tree.map((n) => n.name)).toEqual([
      "clips",
      "deep",
      "plain",
      "songs",
      "README.md",
    ]);
  });

  it("tells binary files from text so the tree can refuse to edit them", () => {
    expect(at("songs/first.st0/audio/kick.wav")?.kind).toBe("binary");
    expect(at("songs/first.st0/tracks/bass.yaml")?.kind).toBe("text");
  });

  it("keeps full repository-relative paths on every node", () => {
    expect(at("songs/first.st0/tracks")?.path).toBe("songs/first.st0/tracks");
  });
});
