import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chokidar from "chokidar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeModuleWatch,
  watchedProjects,
  watchModuleFolders,
} from "./moduleWatch.ts";
import { Workspace } from "./workspace.ts";

// Reproduces the Windows EPERM: a fire-and-forget watcher close, so the rename's retry is what recovers.
let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-del-"));
  // A workspace root (no project.yaml of its own) holding one sub-project.
  const proj = join(root, "deltest.k7");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "project.yaml"), "package k7\n");
  writeFileSync(join(proj, "beat.strudel"), 's("bd")\n');
  ws = new Workspace(root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.deleteProject", () => {
  it("lets go of the module watch it holds, before the rename", async () => {
    // The Windows EPERM this fixes: `fs.watch` holds the directory open, and the watch is dropped
    // only when the session SWITCHES project — never on one that is being deleted.
    const proj = join(root, "deltest.k7");
    mkdirSync(join(proj, "modules"), { recursive: true });
    mkdirSync(join(proj, "nodes"), { recursive: true });
    watchModuleFolders(proj);
    expect(watchedProjects()).toContain(proj);

    await ws.deleteProject("deltest.k7");
    // Without this the folder is still held, and Windows answers EPERM on the rename below.
    expect(watchedProjects()).not.toContain(proj);
    expect(existsSync(proj)).toBe(false);
  });

  it("leaves ANOTHER project's watch alone", async () => {
    const proj = join(root, "deltest.k7");
    const other = join(root, "keep.k7");
    mkdirSync(join(other, "modules"), { recursive: true });
    writeFileSync(join(other, "project.yaml"), "package k7\n");
    watchModuleFolders(proj);
    watchModuleFolders(other);

    await ws.deleteProject("deltest.k7");
    // Only what was under the folder that moved: the neighbour is still being watched.
    expect(watchedProjects()).toEqual([other]);
    closeModuleWatch(other);
  });

  it("deletes a project whose folder a file watcher is holding open", async () => {
    const proj = join(root, "deltest.k7");
    const watcher = chokidar.watch(proj, { ignoreInitial: true });
    await once(watcher, "ready"); // the OS directory handle is now actually open

    const { recycled } = await ws.deleteProject("deltest.k7", () => {
      void watcher.close(); // fire-and-forget: the rename retry must cover the lingering handle
    });

    expect(recycled).toContain("_recycle_bin");
    expect(existsSync(proj)).toBe(false); // moved out of place
    expect(existsSync(join(root, recycled))).toBe(true); // now in the bin
  });

  it("refuses to delete the workspace root", async () => {
    await expect(ws.deleteProject(".")).rejects.toThrow(/workspace root/);
  });
});
