import { describe, expect, it } from "vitest";
import { buildTree, projectDirs } from "./mirror.ts";

const FILES = [
  "README.md",
  "songs/first.l8/project.yaml",
  "songs/first.l8/tracks/bass.yaml",
  "songs/first.l8/audio/kick.wav",
  "songs/live.m9/chains.yaml",
  "clips/le clip.v1/project.yaml",
  "clips/le clip.v1/video_tracks/main.yaml",
  "songs/notes.txt",
  "deep/a/b/c.l8/project.yaml",
  // A folder with a project file but NO suffix is not a project any more — the name decides.
  "plain/project.yaml",
  "node_modules/pkg/index.js",
  ".github/workflows/ci.yml",
];

describe("projectDirs", () => {
  it("finds a project by its suffix, at any depth, and says which app", () => {
    expect(projectDirs(FILES)).toEqual(
      new Map([
        ["songs/first.l8", "l8"],
        ["songs/live.m9", "m9"],
        ["clips/le clip.v1", "v1"],
        ["deep/a/b/c.l8", "l8"],
      ]),
    );
  });

  it("does not care what is inside", () => {
    // No project.yaml anywhere here: the name is the whole rule.
    expect(projectDirs(["set.m9/notes.txt"])).toEqual(
      new Map([["set.m9", "m9"]]),
    );
  });

  it("ignores a FILE that ends in the suffix — only folders are projects", () => {
    expect(projectDirs(["notes.l8", "a/thing.m9"])).toEqual(new Map());
  });

  it("refuses a bare suffix as a name of its own", () => {
    // `.l8/` is a dotfolder, which the tree hides anyway; it names no project either.
    expect(projectDirs([".l8/project.yaml"])).toEqual(new Map());
  });

  it("reports a project nested inside another, rather than hiding it", () => {
    expect(projectDirs(["song.l8/set.m9/chains.yaml"])).toEqual(
      new Map([
        ["song.l8", "l8"],
        ["song.l8/set.m9", "m9"],
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
    expect(at("songs/first.l8")).toMatchObject({ project: true, app: "l8" });
    expect(at("songs/live.m9")).toMatchObject({ project: true, app: "m9" });
    expect(at("deep/a/b/c.l8")?.app).toBe("l8");
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
      "deep",
      "plain",
      "songs",
      "README.md",
    ]);
  });

  it("tells binary files from text so the tree can refuse to edit them", () => {
    expect(at("songs/first.l8/audio/kick.wav")?.kind).toBe("binary");
    expect(at("songs/first.l8/tracks/bass.yaml")?.kind).toBe("text");
  });

  it("keeps full repository-relative paths on every node", () => {
    expect(at("songs/first.l8/tracks")?.path).toBe("songs/first.l8/tracks");
  });
});
