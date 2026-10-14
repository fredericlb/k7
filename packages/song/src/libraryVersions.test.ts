// A library laid out as versions resolves at the version the WORKSPACE pins, the draft only for a
// pin or an admin's overlay, and a library still in one folder as its own version 1 — see
// ../../../docs/library-versions-plan.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isLibraryRootEditable,
  libraryFamilyRoot,
  libraryOf,
  libraryRoot,
  libraryVersions,
  moduleLibraryDirs,
  moduleNamespaceOf,
  setLibraryOverlays,
} from "./sharedFolders";
import { librariesFixture } from "./testSupport";

describe("library versions", () => {
  let ws: string;
  let project: string;
  let lib: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-versions-"));
    project = join(ws, "song");
    mkdirSync(project, { recursive: true });
    lib = librariesFixture(ws);
    for (const v of ["1", "2", "draft"])
      mkdirSync(join(lib, v, "modules"), { recursive: true });
  });
  afterEach(() => {
    setLibraryOverlays([]);
    rmSync(ws, { recursive: true, force: true });
  });

  const pin = (text: string) =>
    writeFileSync(join(ws, "_library-pins.yaml"), text);

  it("reads an unpinned workspace at version 1, and a pinned one at its pin", () => {
    expect(libraryVersions("st0")).toEqual([1, 2]);
    expect(libraryRoot("st0", project)).toBe(join(lib, "1"));
    pin("st0: 2\n");
    expect(libraryRoot("st0", project)).toBe(join(lib, "2"));
    expect(moduleLibraryDirs(project)).toEqual([join(lib, "2", "modules")]);
    pin("st0: draft\n");
    expect(libraryRoot("st0", project)).toBe(join(lib, "draft"));
  });

  it("names a version folder's library by its path, and keeps a module inside the version it was loaded from", () => {
    const mod = join(lib, "2", "modules");
    expect(libraryOf(mod)).toEqual({ name: "st0", root: join(lib, "2") });
    expect(moduleNamespaceOf(mod)).toBe("st0");
    mkdirSync(join(lib, "2", "irs"));
    expect(libraryFamilyRoot("st0", "irs", join(mod, "amp"))).toBe(
      join(lib, "2", "irs"),
    );
  });

  it("lets an admin write the draft and never a published version", () => {
    setLibraryOverlays([{ name: "st0", root: join(lib, "draft") }]);
    expect(libraryRoot("st0", project)).toBe(join(lib, "draft"));
    const editable = (path: string) => {
      const at = libraryOf(path);
      return at !== null && isLibraryRootEditable(at);
    };
    expect(editable(join(lib, "draft", "x"))).toBe(true);
    expect(editable(join(lib, "2", "x"))).toBe(false);
    pin("st0: 2\n");
    // A pin outranks the overlay: the admin hears what the workspace pinned.
    expect(libraryRoot("st0", project)).toBe(join(lib, "2"));
  });

  it("reads a library still in one folder as every version of itself", () => {
    const flat = librariesFixture(ws, "drums");
    mkdirSync(join(flat, "modules"), { recursive: true });
    pin("drums: 3\n");
    expect(libraryVersions("drums")).toEqual([1]);
    expect(libraryRoot("drums", project)).toBe(flat);
    expect(libraryOf(join(flat, "modules"))).toEqual({
      name: "drums",
      root: flat,
    });
  });
});
