import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasSharedModules,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "./sharedFolders";

// A workspace is projects side by side with the shared modules they all draw from:
//
//   ws/_modules/            the shared modules  (@workspace)
//   ws/_libraries/modules/  the account's library submodule  (@st0)
//   ws/song/                a project
//
// There is no shared ASSET folder any more: a file a plugin loads lives in the `assets/` of the
// module that names it, so the module travels whole (see moduleAssets.test.ts).
//
// A project sees the modules because of WHERE they are. `modules_from`/`libraries_from` used to
// declare them and are gone: the list could only ever name these two places plus the
// médiathèque, so it decided nothing while giving every project a way to be wrong about it —
// a project older than the line saw no médiathèque, and a folder deleted from the workspace
// left a declaration behind that took the whole song down.
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
    // The library submodule is IN the workspace now, so there is no machine-wide folder to
    // point an env var at and nothing to restore: it is just another folder under `ws`.
    libraries = join(ws, "_libraries");
  });
  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  const addModules = () => mkdirSync(join(ws, "_modules"), { recursive: true });
  const addMediatek = (kind: "modules" | "chains") =>
    mkdirSync(join(libraries, kind), { recursive: true });

  it("sees nothing when the folder is not there", () => {
    // And that is a working state, not a failure: a project with no shared folder has its
    // own `modules/` and the engine's catalogue, which is a whole song's worth of vocabulary.
    expect(hasSharedModules(project)).toBe(false);
    expect(moduleLibraryDirs(project)).toEqual([]);
  });

  it("finds the workspace's folder on the strength of the folder alone", () => {
    // No config, no declaration: a root is `@workspace` for WHERE it sits.
    addModules();
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("finds the médiathèque with nothing said anywhere", () => {
    addMediatek("modules");
    expect(moduleLibraryDirs(project)).toEqual([join(libraries, "modules")]);
  });

  it("puts the workspace's own first — order is precedence", () => {
    // What sits beside the song beats what the account's library repository brings along.
    // loadUiLibrary reads the list in this order.
    addModules();
    addMediatek("modules");
    expect(moduleLibraryDirs(project)).toEqual([
      join(ws, "_modules"),
      join(libraries, "modules"),
    ]);
  });

  it("ignores a project header that still declares the old fields", () => {
    // Every song already written carries them. They are accepted by the schema and read by
    // nothing — `deadProjectFields` is what says so out loud, rather than leaving it silent.
    addModules();
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from: [ ../vendor ]\n  libraries_from: [ ../other ]\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("needs no project file at all to answer", () => {
    // The folders are found by location, so there is no header to read first — which is what
    // makes a missing or unparseable one cost the compile and not the vocabulary.
    addModules();
    rmSync(join(project, "project.yaml"));
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("survives a declaration naming a folder that is gone", () => {
    // The failure this removes: a `_modules` deleted from the workspace left its line behind,
    // `loadModuleRefs` threw on a root it could not resolve, and the whole song went dark for
    // one stale line. Now the line is ignored and the médiathèque still answers.
    addMediatek("modules");
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from:\n    - ../_modules\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(libraries, "modules")]);
  });

  it("names each root by where it sits", () => {
    addModules();
    addMediatek("modules");
    expect(moduleNamespaceOf(join(ws, "_modules"))).toBe("workspace");
    // `st0`, after the app that served the library when the level was named (it is pl8 now, and
    // the level stayed put) — NOT after the folder it is mounted in.
    // The level is read off `_libraries/`, the parent the submodule is checked out under;
    // it used to be an exact match against `~/.studio/mediatek`, one path per machine.
    expect(moduleNamespaceOf(join(libraries, "modules"))).toBe("st0");
  });
});

// A CHAIN template lives inside the library repository, and its nodes name `@st0/…` modules that
// sit two folders up in that same repo. `../_libraries` resolves to nothing from there, so a chain
// loaded on its own used to see NO catalogue and drew every node as a missing plugin.
describe("a folder INSIDE the library repository", () => {
  it("reaches the library's own modules", () => {
    const ws = mkdtempSync(join(tmpdir(), "inside-"));
    try {
      mkdirSync(join(ws, "_libraries", "modules", "audio"), {
        recursive: true,
      });
      const chain = join(ws, "_libraries", "chains", "process", "normalize");
      mkdirSync(chain, { recursive: true });
      expect(moduleLibraryDirs(chain)).toEqual([
        join(ws, "_libraries", "modules"),
      ]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("is not a search — a folder with no `_libraries` on its path finds nothing", () => {
    // The rule this file exists to keep: these are FIXED locations. The segment is either on the
    // path or it is not, and nothing walks up hunting for one.
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    try {
      expect(moduleLibraryDirs(bare)).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
