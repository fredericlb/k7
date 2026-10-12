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
import { activeMarkerOf, Workspace } from "./workspace.ts";

// The two consequences of being opened ON a project instead of picking one — see docs/activeProject.md.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-active-"));
  cpSync(SONG, join(root, "song.st0"), { recursive: true });
  // The rest of a real workspace: another song, the shared library, and a foreign session.
  cpSync(SONG, join(root, "other.st0"), { recursive: true });
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
    expect(names()).toContain("other.st0");
    expect(names()).toContain("orig");
  });

  it("goes on showing it once a project is open — that is what the selector picks from", () => {
    ws.setActiveProject("song.st0");
    const shown = names();
    // Both songs, and the repository around them: opening one narrows the ENGINE, not the tree.
    expect(shown).toContain("song.st0");
    expect(shown).toContain("other.st0");
    expect(shown).toContain("_modules");
    expect(shown).toContain("orig");
  });

  it("marks every project, so a row knows which one to offer the engine to", () => {
    ws.setActiveProject("song.st0");
    const projects = ws
      .tree()
      .filter((n) => n.project)
      .map((n) => n.path)
      .sort();
    expect(projects).toEqual(["other.st0", "song.st0"]);
  });

  it("keeps paths workspace-relative, so every other route still takes them", () => {
    ws.setActiveProject("song.st0");
    const song = ws.tree().find((n) => n.name === "song.st0");
    const projectYaml = song?.children?.find((n) => n.name === "project.yaml");
    expect(projectYaml?.path).toBe("song.st0/project.yaml");
    expect(ws.read("song.st0/project.yaml").content).toContain("project:");
  });

  it("still lists every project in the workspace", () => {
    // workspaceInfo walks the ROOT, not the tree — the two answer different questions.
    ws.setActiveProject("song.st0");
    expect(ws.workspaceInfo().projects.sort()).toEqual([
      "other.st0",
      "song.st0",
    ]);
  });

  it("finds a project at a depth, and inside another one", () => {
    // Both are addresses the vocabulary supports, so the scan may not stop at the first it recognises.
    mkdirSync(join(root, "albums", "winter.st0"), { recursive: true });
    mkdirSync(join(root, "song.st0", "live.z0"), { recursive: true });
    expect(new Workspace(root).workspaceInfo().projects.sort()).toEqual([
      "albums/winter.st0",
      "other.st0",
      "song.st0",
      "song.st0/live.z0",
    ]);
  });
});

// `/band` with no project after it: the workspace decides which of its projects opens.
describe("the project a bare workspace address opens", () => {
  it("takes the one last open, whatever order the disk is in", () => {
    ws.setActiveProject("other.st0");
    expect(new Workspace(root).defaultProject()).toBe("other.st0");
  });

  it("falls to the first on disk when nothing was ever opened", () => {
    expect(ws.defaultProject()).toBe("other.st0"); // alphabetical: the walk's order, not a preference
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
    const single = join(holder, "hiver.st0");
    mkdirSync(single);
    try {
      // A workspace whose own folder claims st0 has one project and it is the root.
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
    ws.createProject("arrangement", "brandnew.st0");
    expect(ws.workspaceInfo().projects).toContain("brandnew.st0");
  });

  it("stops showing one it recycled", async () => {
    ws.workspaceInfo();
    await ws.deleteProject("other.st0");
    expect(ws.workspaceInfo().projects).not.toContain("other.st0");
  });

  it("reuses the answer for a folder that appeared behind its back", () => {
    // The trade: a relayed edit or a hand-made folder is seen on the next rescan, not on the next poll.
    ws.workspaceInfo();
    mkdirSync(join(root, "outside.st0"), { recursive: true });
    expect(ws.workspaceInfo().projects).not.toContain("outside.st0");
    expect(new Workspace(root).workspaceInfo().projects).toContain(
      "outside.st0",
    );
  });
});

describe("opening a project pl8 named out of a stale mirror", () => {
  it("refuses a `.st0` folder that is not there, saying so", () => {
    // The name rule alone says yes, and the failure surfaced later as "unsupported song" — the wrong thing.
    expect(() => ws.setActiveProject("01_danse.st0")).toThrow(
      /no project '01_danse\.st0' in this workspace/,
    );
  });

  it("leaves the project that was open alone when a bad open is refused", () => {
    ws.setActiveProject("song.st0");
    expect(() => ws.setActiveProject("gone.st0")).toThrow();
    expect(ws.workspaceInfo().activeProject).toBe("song.st0");
  });

  it("does not restore a marker pointing at a project that has been removed", () => {
    ws.setActiveProject("song.st0");
    rmSync(join(root, "song.st0"), { recursive: true, force: true });
    // A fresh Workspace reads the marker; the name still claims st0, the folder is gone.
    expect(new Workspace(root).workspaceInfo().activeProject).toBe(null);
  });

  it("keeps its marker BESIDE the workspace, where no sync of it sees it", () => {
    ws.setActiveProject("song.st0");
    expect(readdirSync(root)).not.toContain(".studio-active");
    expect(readFileSync(activeMarkerOf(root), "utf8").trim()).toBe("song.st0");
    expect(new Workspace(root).workspaceInfo().activeProject).toBe("song.st0");
  });

  it("moves a marker the workspace still holds out of it, and keeps what it said", () => {
    writeFileSync(join(root, ".studio-active"), "song.st0\n");
    expect(new Workspace(root).workspaceInfo().activeProject).toBe("song.st0");
    expect(existsSync(join(root, ".studio-active"))).toBe(false);
    expect(readFileSync(activeMarkerOf(root), "utf8").trim()).toBe("song.st0");
  });
});
