// A library's SOUNDS through the service: a file dropped on its `samples/` lands in the library's
// clone, not in the workspace, and the Libraries tab's listing shows it (@studio/song's libraryFiles.md).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  root = mkdtempSync(join(tmpdir(), "td-libsnd-"));
  lib = librariesFixture(root, "st0");
  mkdirSync(join(lib, "modules"), { recursive: true });
  mkdirSync(join(lib, "samples"), { recursive: true });
  const proj = join(root, "song.st0");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "project.yaml"), 'project:\n  name: "song"\n');
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
  // An admin's own clone of `st0`: the one state in which a file may land in a library.
  setLibraryOverlays([{ name: "st0", root: lib }]);
});
afterEach(() => {
  setLibraryOverlays([]);
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("lands a sample dropped on a library's samples/ in that library's clone", () => {
  ws.uploadFile("_libraries/st0/samples", "kicks/808.wav", Buffer.from("RIFF"));
  expect(existsSync(join(lib, "samples", "kicks", "808.wav"))).toBe(true);
  expect(existsSync(join(root, "_libraries"))).toBe(false);
});

it("lists the library's samples beside its modules, for the tab to draw and take drops on", () => {
  mkdirSync(join(lib, "samples", "kicks"), { recursive: true });
  writeFileSync(join(lib, "samples", "kicks", "808.wav"), "");
  const st0 = ws.moduleLibraries().find((l) => l.ns === "st0");
  const flat = JSON.stringify(st0?.samples);
  expect(flat).toContain("_libraries/st0/samples/kicks/808.wav");
  expect(st0?.irs).toEqual([]);
});
