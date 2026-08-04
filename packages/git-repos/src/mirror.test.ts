import { describe, expect, it } from "vitest";
import { buildTree, projectDirs } from "./mirror.ts";

const FILES = [
  "README.md",
  "songs/first/project.yaml",
  "songs/first/tracks/bass.yaml",
  "songs/first/audio/kick.wav",
  "songs/second/project.yml",
  "songs/second/clips/a.yaml",
  "songs/notes.txt",
  "deep/a/b/c/project.yaml",
  "node_modules/pkg/index.js",
  ".github/workflows/ci.yml",
];

describe("projectDirs", () => {
  it("finds a project at any depth, and both spellings", () => {
    expect(projectDirs(FILES)).toEqual(
      new Set(["songs/first", "songs/second", "deep/a/b/c"]),
    );
  });

  it("reports the repository root as an empty string", () => {
    expect(projectDirs(["project.yaml", "tracks/a.yaml"])).toEqual(
      new Set([""]),
    );
  });

  it("is not fooled by a name that merely contains the word", () => {
    expect(projectDirs(["a/my-project.yaml", "b/project.yaml.bak"])).toEqual(
      new Set(),
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

  it("marks the project folders and only those", () => {
    expect(at("songs/first")?.project).toBe(true);
    expect(at("deep/a/b/c")?.project).toBe(true);
    expect(at("songs")?.project).toBeUndefined();
    expect(at("deep/a")?.project).toBeUndefined();
  });

  it("drops dotfolders and node_modules with their whole subtree", () => {
    expect(at("node_modules")).toBeUndefined();
    expect(at(".github")).toBeUndefined();
  });

  it("sorts folders before files, then by name", () => {
    expect(tree.map((n) => n.name)).toEqual(["deep", "songs", "README.md"]);
  });

  it("tells binary files from text so the tree can refuse to edit them", () => {
    expect(at("songs/first/audio/kick.wav")?.kind).toBe("binary");
    expect(at("songs/first/tracks/bass.yaml")?.kind).toBe("text");
  });

  it("keeps full repository-relative paths on every node", () => {
    expect(at("songs/first/tracks")?.path).toBe("songs/first/tracks");
  });
});
