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
import { Workspace } from "./workspace.ts";

// Reproduces the Windows EPERM: deleting a project moves its folder to the recycle bin,
// but the folder is held open by the strudel file watcher. If the rename races the OS
// releasing that directory handle it fails with EPERM — so deleteProject retries. Here
// `beforeMove` closes the watcher fire-and-forget (the old, racy pattern) to force the
// retry to be what recovers the delete.
let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-del-"));
  // A workspace root (no project.yaml of its own) holding one sub-project.
  const proj = join(root, "deltest");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "project.yaml"), "package lanes\n");
  writeFileSync(join(proj, "beat.strudel"), 's("bd")\n');
  ws = new Workspace(root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.deleteProject", () => {
  it("deletes a project whose folder a file watcher is holding open", async () => {
    const proj = join(root, "deltest");
    const watcher = chokidar.watch(proj, { ignoreInitial: true });
    await once(watcher, "ready"); // the OS directory handle is now actually open

    const { recycled } = await ws.deleteProject("deltest", () => {
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
