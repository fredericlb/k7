import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

// Two consequences of an app being opened ON a project instead of picking one: the tree is
// the project's rather than the clone's, and a project pl8 named out of a stale mirror has
// to be refused HERE, by name and by existence. See docs/activeProject.md.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
);

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-active-"));
  cpSync(SONG, join(root, "song.st0"), { recursive: true });
  // The rest of a real clone: another song, the shared library, and a foreign session.
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
afterEach(() => rmSync(root, { recursive: true, force: true }));

const names = (): string[] =>
  ws
    .tree()
    .map((n) => n.name)
    .sort();

describe("the tree is rooted at the active project", () => {
  it("shows the whole workspace while nothing is open", () => {
    // Nothing has been opened, so there is no narrower answer to give.
    expect(names()).toContain("other.st0");
    expect(names()).toContain("orig");
  });

  it("shows only the open project's own files once one is open", () => {
    ws.setActiveProject("song.st0");
    const shown = names();
    expect(shown).toContain("nodes");
    expect(shown).toContain("project.yaml");
    // The rest of the clone is the REPOSITORY, not the song.
    expect(shown).not.toContain("other.st0");
    expect(shown).not.toContain("_modules");
    expect(shown).not.toContain("orig");
  });

  it("keeps paths workspace-relative, so every other route still takes them", () => {
    ws.setActiveProject("song.st0");
    const projectYaml = ws.tree().find((n) => n.name === "project.yaml");
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
    // Both are arrangements the address vocabulary supports (`songs/winter.st0`, and a nested
    // set), so the scan may not stop at the first project it recognises.
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

// The list is the expensive half of a route polled every two seconds by every tab: 721
// directories on a real workspace. It is therefore held, and the holding has to be right in
// the one case that matters — a project this service just made.
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
    // The trade, stated: a `git pull` or a hand-made folder is seen on the next rescan, not on
    // the next poll. If this ever becomes false the window was removed, not merely shortened.
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
    // The name rule alone says yes here, and the failure then surfaced much later as
    // @studio/song's "unsupported song" — true, and about the wrong thing.
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
    // A fresh Workspace reads `.studio-active`; the name still claims st0, the folder is gone.
    expect(new Workspace(root).workspaceInfo().activeProject).toBe(null);
  });
});
