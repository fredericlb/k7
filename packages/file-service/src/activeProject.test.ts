import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeMarkerOf } from "./activeMarker.ts";
import { Workspace } from "./workspace.ts";

// The two consequences of being opened ON a project instead of picking one — see docs/activeProject.md.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.k7");

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-active-"));
  cpSync(SONG, join(root, "song.k7"), { recursive: true });
  // The rest of a real workspace: another song, the shared library, and a foreign session.
  cpSync(SONG, join(root, "other.k7"), { recursive: true });
  mkdirSync(join(root, "_modules", "audio"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "note.txt"),
    "shared\n",
    "utf8",
  );
  mkdirSync(join(root, "orig"), { recursive: true });
  writeFileSync(join(root, "orig", "old.als"), "binary\n", "utf8");
  ws = new Workspace(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(activeMarkerOf(root), { force: true });
});

const names = (): string[] =>
  ws
    .tree()
    .map((n) => n.name)
    .sort();

describe("the tree is rooted at the workspace", () => {
  it("shows the whole workspace while nothing is open", () => {
    expect(names()).toContain("other.k7");
    expect(names()).toContain("orig");
  });

  it("goes on showing it once a project is open — that is what the selector picks from", () => {
    ws.setActiveProject("song.k7");
    const shown = names();
    // Both songs, and the repository around them: opening one narrows the ENGINE, not the tree.
    expect(shown).toContain("song.k7");
    expect(shown).toContain("other.k7");
    expect(shown).toContain("_modules");
    expect(shown).toContain("orig");
  });

  it("marks every project, so a row knows which one to offer the engine to", () => {
    ws.setActiveProject("song.k7");
    const projects = ws
      .tree()
      .filter((n) => n.project)
      .map((n) => n.path)
      .sort();
    expect(projects).toEqual(["other.k7", "song.k7"]);
  });

  it("keeps paths workspace-relative, so every other route still takes them", () => {
    ws.setActiveProject("song.k7");
    const song = ws.tree().find((n) => n.name === "song.k7");
    const projectFile = song?.children?.find((n) => n.name === "project.k7x");
    expect(projectFile?.path).toBe("song.k7/project.k7x");
    expect(ws.read("song.k7/project.k7x").content).toContain("project({");
  });

  it("still lists every project in the workspace", () => {
    // workspaceInfo walks the ROOT, not the tree — the two answer different questions.
    ws.setActiveProject("song.k7");
    expect(ws.workspaceInfo().projects.sort()).toEqual(["other.k7", "song.k7"]);
  });

  it("finds a project at a depth, and inside another one", () => {
    // Both are addresses the vocabulary supports, so the scan may not stop at the first it recognises.
    mkdirSync(join(root, "albums", "winter.k7"), { recursive: true });
    mkdirSync(join(root, "song.k7", "live.k7"), { recursive: true });
    expect(new Workspace(root).workspaceInfo().projects.sort()).toEqual([
      "albums/winter.k7",
      "other.k7",
      "song.k7",
      "song.k7/live.k7",
    ]);
  });
});

// `/band` with no project after it: the workspace decides which of its projects opens.
describe("the project a bare workspace address opens", () => {
  it("takes the one last open, whatever order the disk is in", () => {
    ws.setActiveProject("other.k7");
    expect(new Workspace(root).defaultProject()).toBe("other.k7");
  });

  it("falls to the first on disk when nothing was ever opened", () => {
    expect(ws.defaultProject()).toBe("other.k7"); // alphabetical: the walk's order, not a preference
  });

  it("answers null for a workspace holding no project — a tree and nothing more", () => {
    const empty = mkdtempSync(join(tmpdir(), "td-empty-"));
    try {
      expect(new Workspace(empty).defaultProject()).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("is `.` when the workspace IS the project", () => {
    const holder = mkdtempSync(join(tmpdir(), "td-one-"));
    const single = join(holder, "hiver.k7");
    mkdirSync(single);
    try {
      // A workspace whose own folder claims k7 has one project and it is the root.
      expect(new Workspace(single).defaultProject()).toBe(".");
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  });
});

// 721 directories on a real workspace, polled every two seconds by every tab — hence the held list.
describe("the project list is scanned, not re-walked on every poll", () => {
  it("shows a project it created straight away", () => {
    ws.workspaceInfo(); // fills the cache
    ws.createProject("arrangement", "brandnew.k7");
    expect(ws.workspaceInfo().projects).toContain("brandnew.k7");
  });

  it("stops showing one it recycled", async () => {
    ws.workspaceInfo();
    await ws.deleteProject("other.k7");
    expect(ws.workspaceInfo().projects).not.toContain("other.k7");
  });

  it("reuses the answer for a folder that appeared behind its back", () => {
    // The trade: a relayed edit or a hand-made folder is seen on the next rescan, not on the next poll.
    ws.workspaceInfo();
    mkdirSync(join(root, "outside.k7"), { recursive: true });
    expect(ws.workspaceInfo().projects).not.toContain("outside.k7");
    expect(new Workspace(root).workspaceInfo().projects).toContain(
      "outside.k7",
    );
  });
});

describe("opening a project pl8 named out of a stale mirror", () => {
  it("refuses a `.k7` folder that is not there, saying so", () => {
    // The name rule alone says yes, and the failure surfaced later as "unsupported song" — the wrong thing.
    expect(() => ws.setActiveProject("01_danse.k7")).toThrow(
      /no project '01_danse\.k7' in this workspace/,
    );
  });

  it("leaves the project that was open alone when a bad open is refused", () => {
    ws.setActiveProject("song.k7");
    expect(() => ws.setActiveProject("gone.k7")).toThrow();
    expect(ws.workspaceInfo().activeProject).toBe("song.k7");
  });

  it("does not restore a marker pointing at a project that has been removed", () => {
    ws.setActiveProject("song.k7");
    rmSync(join(root, "song.k7"), { recursive: true, force: true });
    // A fresh Workspace reads the marker; the name still claims k7, the folder is gone.
    expect(new Workspace(root).workspaceInfo().activeProject).toBe(null);
  });

  it("keeps its marker BESIDE the workspace, where no sync of it sees it", () => {
    ws.setActiveProject("song.k7");
    expect(readdirSync(root)).not.toContain(".studio-active");
    expect(readFileSync(activeMarkerOf(root), "utf8").trim()).toBe("song.k7");
    expect(new Workspace(root).workspaceInfo().activeProject).toBe("song.k7");
  });

  it("moves a marker the workspace still holds out of it, and keeps what it said", () => {
    writeFileSync(join(root, ".studio-active"), "song.k7\n");
    expect(new Workspace(root).workspaceInfo().activeProject).toBe("song.k7");
    expect(existsSync(join(root, ".studio-active"))).toBe(false);
    expect(readFileSync(activeMarkerOf(root), "utf8").trim()).toBe("song.k7");
  });
});
