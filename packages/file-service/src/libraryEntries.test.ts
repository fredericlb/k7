// Renaming and deleting inside a LIBRARY from the Libraries tab: both act on the library's folder, a
// delete lands in the library's OWN bin (the workspace's may be on another disk), the library itself
// stays out of reach, and a module's refs follow a rename.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLibraryOverlays } from "@studio/song/sharedFolders";
import { librariesFixture } from "@studio/song/testSupport";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let lib: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-libent-"));
  lib = librariesFixture(root, "k7-core");
  const mod = join(lib, "modules", "audio", "verb");
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "module.yaml"), 'extends: "@engine/reverb"\n');
  const proj = join(root, "song.k7");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "project.yaml"), 'project:\n  name: "song"\n');
  ws = new Workspace(root);
  ws.setActiveProject("song.k7");
  // An admin's own clone of `k7`: the one state in which a library entry may change.
  setLibraryOverlays([{ name: "k7-core", root: lib }]);
});
afterEach(() => {
  setLibraryOverlays([]);
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("refuses to rename or delete a library entry to an account holding no clone of it", async () => {
  setLibraryOverlays([]);
  await expect(
    ws.renameEntry("_libraries/k7-core/modules/audio/verb", "hall"),
  ).rejects.toThrow(/admins/);
  await expect(
    ws.deleteEntry("_libraries/k7-core/modules/audio/verb"),
  ).rejects.toThrow(/admins/);
  expect(existsSync(join(lib, "modules", "audio", "verb"))).toBe(true);
});

it("renames a module inside the library's clone", async () => {
  const { path } = await ws.renameEntry(
    "_libraries/k7-core/modules/audio/verb",
    "hall",
  );
  expect(path).toBe("_libraries/k7-core/modules/audio/hall");
  expect(existsSync(join(lib, "modules", "audio", "hall", "module.yaml"))).toBe(
    true,
  );
});

it("recycles a module into the library's own bin, never the workspace's", async () => {
  const { recycled } = await ws.deleteEntry(
    "_libraries/k7-core/modules/audio/verb",
  );
  expect(existsSync(join(lib, "modules", "audio", "verb"))).toBe(false);
  expect(existsSync(join(lib, "_recycle_bin", "verb", "module.yaml"))).toBe(
    true,
  );
  expect(recycled).toBe("_libraries/k7-core/_recycle_bin/verb");
  expect(existsSync(join(root, "_recycle_bin"))).toBe(false);
});

it("refuses to rename or delete the library itself", async () => {
  await expect(ws.deleteEntry("_libraries/k7-core")).rejects.toThrow(
    /listed by the admins/,
  );
  await expect(ws.renameEntry("_libraries/k7-core", "x")).rejects.toThrow(
    /listed by the admins/,
  );
});

it("renaming a FOLDER repoints every module inside it, in the songs and in the library", async () => {
  // Two modules in a category, a song using one, a library chain using the other — and a lookalike.
  for (const m of ["echo", "slap"]) {
    const at = join(lib, "modules", "audio", "time", m);
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, "module.yaml"), 'extends: "@engine/delay"\n');
  }
  const node = join(root, "song.k7", "nodes", "e.yaml");
  mkdirSync(join(root, "song.k7", "nodes"), { recursive: true });
  writeFileSync(
    node,
    'extends: "@k7-core/audio/time/echo"\nengine: x\n# @k7-core/audio/timer/y\n',
  );
  const chain = join(lib, "chains", "v", "nodes", "s.yaml");
  mkdirSync(join(lib, "chains", "v", "nodes"), { recursive: true });
  writeFileSync(chain, "extends: @k7-core/audio/time/slap\n");

  const { path, repointed } = await ws.renameEntry(
    "_libraries/k7-core/modules/audio/time",
    "delays",
  );
  expect(path).toBe("_libraries/k7-core/modules/audio/delays");
  expect(readFileSync(node, "utf8")).toBe(
    'extends: "@k7-core/audio/delays/echo"\nengine: x\n# @k7-core/audio/timer/y\n',
  );
  expect(readFileSync(chain, "utf8")).toBe(
    "extends: @k7-core/audio/delays/slap\n",
  );
  expect(repointed?.length).toBeGreaterThanOrEqual(2);
});

it("renaming a MODULE repoints its own uses", async () => {
  const node = join(root, "song.k7", "nodes", "v.yaml");
  mkdirSync(join(root, "song.k7", "nodes"), { recursive: true });
  writeFileSync(node, 'extends: "@k7-core/audio/verb"\n');
  await ws.renameEntry("_libraries/k7-core/modules/audio/verb", "hall");
  expect(readFileSync(node, "utf8")).toBe('extends: "@k7-core/audio/hall"\n');
});

it("refuses to rename an engine, which nodes pick by name", async () => {
  const eng = join(lib, "modules", "audio", "verb", "engines", "plate");
  mkdirSync(eng, { recursive: true });
  writeFileSync(join(eng, "module.yaml"), 'extends: "@engine/reverb"\n');
  await expect(
    ws.renameEntry(
      "_libraries/k7-core/modules/audio/verb/engines/plate",
      "room",
    ),
  ).rejects.toThrow(/picked by its name/);
  expect(existsSync(eng)).toBe(true);
});
