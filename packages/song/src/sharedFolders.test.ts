import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accountLibraries,
  hasSharedModules,
  libraryFamilyRoot,
  libraryFamilyRoots,
  libraryOf,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "./sharedFolders";
import { librariesFixture } from "./testSupport";

// A project sees `_modules` beside it and every library the machine cloned, by WHERE they sit —
// never by any declaration.
describe("sharedFolders", () => {
  let ws: string;
  let project: string;
  let libraries: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-shared-"));
    project = join(ws, "song");
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n",
      "utf8",
    );
    // The account's `k7-core` library, where the file service clones it: under `$STUDIO_HOME`.
    libraries = librariesFixture(ws);
  });
  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  const addModules = () => mkdirSync(join(ws, "_modules"), { recursive: true });
  const addMediatek = (kind: "modules" | "chains") =>
    mkdirSync(join(libraries, kind), { recursive: true });

  it("sees nothing when the folder is not there", () => {
    // A working state: the project still has its own `modules/` and the engine's catalogue.
    expect(hasSharedModules(project)).toBe(false);
    expect(moduleLibraryDirs(project)).toEqual([]);
  });

  it("finds the workspace's folder on the strength of the folder alone", () => {
    // No config, no declaration: a root is `@workspace` for WHERE it sits.
    addModules();
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("finds a library with nothing said anywhere", () => {
    addMediatek("modules");
    expect(moduleLibraryDirs(project)).toEqual([join(libraries, "modules")]);
  });

  it("puts the workspace's own first — order is precedence", () => {
    // What sits beside the song beats what the account's libraries bring along.
    addModules();
    addMediatek("modules");
    expect(moduleLibraryDirs(project)).toEqual([
      join(ws, "_modules"),
      join(libraries, "modules"),
    ]);
  });

  it("ignores a project header that still declares the old fields", () => {
    // Every song already written carries them: the schema accepts them and nothing reads them.
    addModules();
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from: [ ../vendor ]\n  libraries_from: [ ../other ]\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("needs no project file at all to answer", () => {
    // Found by location, so an unparseable header costs the compile and not the vocabulary.
    addModules();
    rmSync(join(project, "project.yaml"));
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("survives a declaration naming a folder that is gone", () => {
    // A declaration naming a deleted `_modules` must not throw and take the whole song down.
    addMediatek("modules");
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from:\n    - ../_modules\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(libraries, "modules")]);
  });

  it("names each root by where it sits — a library by its NAME", () => {
    addModules();
    addMediatek("modules");
    expect(moduleNamespaceOf(join(ws, "_modules"))).toBe("workspace");
    expect(moduleNamespaceOf(join(libraries, "modules"))).toBe("k7-core");
  });

  it("sees EVERY library the machine cloned, each under its own name", () => {
    addMediatek("modules");
    const drums = librariesFixture(ws, "drums");
    mkdirSync(join(drums, "modules"), { recursive: true });
    expect(accountLibraries().map((l) => l.name)).toEqual(["drums", "k7-core"]);
    expect(moduleLibraryDirs(project)).toEqual([
      join(drums, "modules"),
      join(libraries, "modules"),
    ]);
    expect(moduleNamespaceOf(join(drums, "modules"))).toBe("drums");
  });

  it("is not fooled by a folder no library could be called", () => {
    // A clone still filling, or a name a ref already means something else by, is no library.
    const home = join(libraries, "..");
    mkdirSync(join(home, ".cloning-1", "modules"), { recursive: true });
    mkdirSync(join(home, "engine", "modules"), { recursive: true });
    mkdirSync(join(home, "Upper", "modules"), { recursive: true });
    addMediatek("modules");
    expect(accountLibraries().map((l) => l.name)).toEqual(["k7-core"]);
  });

  it("lists one family across the libraries that carry it", () => {
    addMediatek("chains");
    librariesFixture(ws, "drums"); // no chains/ at all
    expect(libraryFamilyRoots("chains")).toEqual([
      { name: "k7-core", root: join(libraries, "chains") },
    ]);
    expect(libraryFamilyRoot("k7-core", "chains")).toBe(
      join(libraries, "chains"),
    );
    expect(libraryFamilyRoot("drums", "chains")).toBeNull();
    expect(libraryFamilyRoot("../k7", "chains")).toBeNull();
  });
});

// A chain template inside a library saw NO catalogue once, so every node drew as a missing plugin.
describe("a folder INSIDE a library", () => {
  it("reaches the libraries' modules, and knows which library it is in", () => {
    const ws = mkdtempSync(join(tmpdir(), "inside-"));
    try {
      const lib = librariesFixture(ws);
      mkdirSync(join(lib, "modules", "audio"), { recursive: true });
      const chain = join(lib, "chains", "process", "normalize");
      mkdirSync(chain, { recursive: true });
      expect(moduleLibraryDirs(chain)).toEqual([join(lib, "modules")]);
      expect(libraryOf(chain)).toEqual({ name: "k7-core", root: lib });
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("is not a search — a folder outside the libraries is in none", () => {
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    try {
      librariesFixture(bare);
      expect(libraryOf(bare)).toBeNull();
      expect(libraryOf(join(bare, "_libraries", "k7-core"))).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
