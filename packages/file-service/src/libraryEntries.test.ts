// Renaming and deleting inside a LIBRARY from the Libraries tab: both act on the library's clone, a
// delete removes in place (the library's history is its bin, and the workspace's bin may be on
// another disk), and the library itself stays out of reach.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { librariesFixture } from "@studio/song/testSupport";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let lib: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-libent-"));
  lib = librariesFixture(root, "st0");
  const mod = join(lib, "modules", "audio", "verb");
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "module.yaml"), 'extends: "@engine/reverb"\n');
  const proj = join(root, "song.st0");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "project.yaml"), 'project:\n  name: "song"\n');
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("renames a module inside the library's clone", async () => {
  const { path } = await ws.renameEntry(
    "_libraries/st0/modules/audio/verb",
    "hall",
  );
  expect(path).toBe("_libraries/st0/modules/audio/hall");
  expect(existsSync(join(lib, "modules", "audio", "hall", "module.yaml"))).toBe(
    true,
  );
});

it("deletes a module in place, putting nothing in the workspace's recycle bin", async () => {
  await ws.deleteEntry("_libraries/st0/modules/audio/verb");
  expect(existsSync(join(lib, "modules", "audio", "verb"))).toBe(false);
  expect(existsSync(join(root, "_recycle_bin"))).toBe(false);
});

it("refuses to rename or delete the library itself", async () => {
  await expect(ws.deleteEntry("_libraries/st0")).rejects.toThrow(/settings/);
  await expect(ws.renameEntry("_libraries/st0", "x")).rejects.toThrow(
    /settings/,
  );
});
