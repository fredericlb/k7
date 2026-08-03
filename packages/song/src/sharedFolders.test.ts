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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureMediatekModules,
  ensureSharedLibrary,
  ensureSharedModules,
  hasSharedLibrary,
  hasSharedModules,
} from "./sharedFolders";

// A workspace is projects side by side with the shared folders they all point at:
//
//   ws/_modules/   the plugin catalogue (needs a config naming its namespace)
//   ws/_library/   ir/ and nam/ assets (no config — just folders of files)
//   ws/song/       a project
//
// Neither folder is visible to a project until its project.yaml says so, which is the
// whole job of this module.
describe("sharedFolders", () => {
  let ws: string;
  let project: string;
  const projectFile = () => readFileSync(join(project, "project.yaml"), "utf8");
  const writeProject = (body: string) =>
    writeFileSync(join(project, "project.yaml"), body, "utf8");

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-shared-"));
    project = join(ws, "song");
    mkdirSync(project, { recursive: true });
    writeProject("project:\n  name: song\n");
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  const addModules = (ext = "yaml") => {
    mkdirSync(join(ws, "_modules"), { recursive: true });
    writeFileSync(
      join(ws, `_modules/config.${ext}`),
      "namespace: engine\n",
      "utf8",
    );
  };
  const addLibrary = () =>
    mkdirSync(join(ws, "_library/nam"), { recursive: true });

  describe("the machine's media library", () => {
    // Named, not located: project.yaml is committed, so the reference has to survive
    // being read on somebody else's machine.
    let media: string;
    beforeEach(() => {
      media = mkdtempSync(join(tmpdir(), "td-media-"));
      process.env.STUDIO_MEDIATEK = media;
    });
    afterEach(() => {
      delete process.env.STUDIO_MEDIATEK;
      rmSync(media, { recursive: true, force: true });
    });

    it("says nothing when this machine has no library", () => {
      // Same rule as the workspace folders: the loader THROWS on a modules_from it can't
      // resolve, so a speculative reference would break a project that worked.
      expect(ensureMediatekModules(project)).toBe(false);
      expect(projectFile()).not.toContain("@mediatek");
    });

    it("writes the token, never the path it resolves to", () => {
      mkdirSync(join(media, "modules"), { recursive: true });
      expect(ensureMediatekModules(project)).toBe(true);
      const text = projectFile();
      expect(text).toContain("@mediatek");
      // The give-away that would betray a machine-specific path leaking into git.
      expect(text).not.toContain(media);
    });

    it("is idempotent and keeps the workspace's own folder first", () => {
      addModules();
      mkdirSync(join(media, "modules"), { recursive: true });
      ensureSharedModules(project);
      expect(ensureMediatekModules(project)).toBe(true);
      expect(ensureMediatekModules(project)).toBe(false);
      const list = projectFile();
      // Order is precedence: what sits beside the song beats what is global to the machine.
      expect(list.indexOf("../_modules")).toBeLessThan(
        list.indexOf("@mediatek"),
      );
    });
  });

  it("does nothing when the workspace has no shared folders", () => {
    // The important half: `loadModuleRefs` THROWS on a modules_from path it can't
    // resolve, so writing one speculatively turns a working project into one that
    // won't load at all.
    expect(hasSharedModules(project)).toBe(false);
    expect(hasSharedLibrary(project)).toBe(false);
    expect(ensureSharedModules(project)).toBe(false);
    expect(ensureSharedLibrary(project)).toBe(false);
    expect(projectFile()).not.toContain("modules_from");
    expect(projectFile()).not.toContain("libraries_from");
  });

  it("points at _modules on the strength of the folder alone", () => {
    // It used to need a config.yaml naming the library, because that declaration was where
    // the namespace came from. A root is `@workspace` for WHERE it sits now, so there is
    // nothing left for the folder to prove beyond existing.
    mkdirSync(join(ws, "_modules"), { recursive: true });
    expect(hasSharedModules(project)).toBe(true);
    expect(ensureSharedModules(project)).toBe(true);
  });

  it("wires each folder once, and is a no-op thereafter", () => {
    addModules();
    addLibrary();
    expect(ensureSharedModules(project)).toBe(true);
    expect(ensureSharedLibrary(project)).toBe(true);
    expect(projectFile()).toContain("modules_from: [ ../_modules ]");
    expect(projectFile()).toMatch(/libraries_from:[\s\S]*\.\.\/_library/);
    // Running it twice must not append a second entry or rewrite the file.
    const after = projectFile();
    expect(ensureSharedModules(project)).toBe(false);
    expect(ensureSharedLibrary(project)).toBe(false);
    expect(projectFile()).toBe(after);
  });

  it("keeps a modules_from the project already had, adding alongside", () => {
    addModules();
    writeProject("project:\n  name: song\n  modules_from: [../vendor]\n");
    expect(ensureSharedModules(project)).toBe(true);
    expect(projectFile()).toContain("../vendor");
    expect(projectFile()).toContain("../_modules");
  });

  it("adds the workspace library alongside one the project already chose", () => {
    // `libraries_from` is a LIST, like modules_from — a project keeps what it named and
    // gains the workspace's, rather than having to pick one.
    addLibrary();
    writeProject("project:\n  name: song\n  libraries_from: [../other]\n");
    expect(ensureSharedLibrary(project)).toBe(true);
    expect(projectFile()).toContain("../other");
    expect(projectFile()).toContain("../_library");
  });

  it("migrates the pre-list `library_from` into the list", () => {
    // One string, one library. A project written before the field became a list would
    // otherwise keep a key nothing reads and silently lose its assets.
    addLibrary();
    writeProject("project:\n  name: song\n  library_from: ../other\n");
    expect(ensureSharedLibrary(project)).toBe(true);
    const out = projectFile();
    expect(out).not.toContain("library_from: ../other");
    expect(out).toContain("libraries_from:");
    expect(out).toContain("../other"); // carried across, not dropped
    expect(out).toContain("../_library");
  });

  it("does nothing without a project file to write into", () => {
    addModules();
    addLibrary();
    rmSync(join(project, "project.yaml"));
    expect(ensureSharedModules(project)).toBe(false);
    expect(ensureSharedLibrary(project)).toBe(false);
    expect(existsSync(join(project, "project.yaml"))).toBe(false);
  });
});
