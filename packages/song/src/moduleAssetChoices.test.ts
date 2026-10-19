// What a file-valued param may be set to. The case that matters is INHERITANCE: a song points at
// a shared amp with a thin local module that extends it, and the files live in the shared folder.
// Looking only under `<project>/modules/<category>/<file>/assets` listed nothing for exactly that
// shape — see docs/filePicker.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetExtsFor, assetsForParam } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModuleRefs, loadModules } from "./loader";
import { moduleAssetChoices } from "./moduleAssetChoices";
import { resolveModuleMap } from "./moduleResolve";
import { librariesFixture, writeDoc, writeNode } from "./testSupport";

let root: string;
let project: string;
/** The `@k7-core` library, mounted in the workspace beside the project — `<ws>/_libraries/modules`. */
let libraries: string;

type Body = Record<string, unknown>;

const writeAssets = (dir: string, assets: string[]) => {
  for (const a of assets) {
    const abs = join(dir, "assets", a);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "x", "utf8");
  }
};

// A module folder with a module.k7x (which is what makes it findable by ref) and some assets.
const mkModule = (dir: string, body: Body, assets: string[] = []) => {
  writeDoc(join(dir, "module.k7x"), body);
  writeAssets(dir, assets);
};

// A project's own USE of a shared module; every node shares `nodes/`, so `assets` lands beside them all.
const mkNode = (name: string, body: Body, assets: string[] = []) => {
  writeNode(project, name, body);
  writeAssets(join(project, "nodes"), assets);
};

const NAM = { plugin: { type: "internal", name: "NAM" } };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "assets-"));
  project = join(root, "ws", "song.k7");
  libraries = join(librariesFixture(join(root, "ws")), "modules");
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("moduleAssetChoices", () => {
  it("lists the module's own assets", () => {
    mkModule(
      join(project, "modules", "audio", "amp"),
      { plugin: { type: "internal", name: "X" } },
      ["jcm800.nam", "Two-Rock/clean.nam"],
    );
    expect(
      moduleAssetChoices(project, { category: "audio", file: "amp" }, {}),
    ).toEqual(["Two-Rock/clean.nam", "jcm800.nam"]);
  });

  it("INHERITS the assets of what it extends, wherever that library is", () => {
    // The guitar case: the project's module is a shell and the `@k7-core` one carries the profiles.
    mkModule(join(libraries, "audio", "amps", "guitar"), NAM, [
      "roland/bright.nam",
      "fender/clean.nam",
    ]);
    mkNode("guitar", { extends: "@k7-core/audio/amps/guitar" });
    // Through the real loaders, since they stamp the FOLDER each module lives in.
    const refs = loadModuleRefs(project, {}, []);
    const mod = loadModules(project).guitar;
    const choices = moduleAssetChoices(project, mod, refs);
    // Its own folder holds none; every choice comes from the ancestor.
    expect(choices.sort()).toEqual(["fender/clean.nam", "roland/bright.nam"]);
  });

  it("walks more than one level, following each ref's own `extends`", () => {
    mkModule(join(libraries, "audio", "amps", "base"), NAM, ["deep.nam"]);
    mkModule(
      join(libraries, "audio", "amps", "mid"),
      { extends: "@k7-core/audio/amps/base" },
      ["mid.nam"],
    );
    mkNode("top", { extends: "@k7-core/audio/amps/mid" });
    const refs = loadModuleRefs(project, {}, []);
    const choices = moduleAssetChoices(project, loadModules(project).top, refs);
    // Nearest first: `mid`'s own, then what IT inherits, two links up.
    expect(choices).toEqual(["mid.nam", "deep.nam"]);
  });

  it("lets a nearer file shadow an inherited one of the same name", () => {
    mkModule(join(libraries, "audio", "amps", "shared"), NAM, ["clean.nam"]);
    mkModule(
      join(project, "modules", "audio", "local"),
      { extends: "@k7-core/audio/amps/shared" },
      ["clean.nam"],
    );
    expect(
      moduleAssetChoices(
        project,
        {
          category: "audio",
          file: "local",
          extends: "@k7-core/audio/amps/shared",
        },
        {},
      ),
    ).toEqual(["clean.nam"]); // once, not twice
  });

  it("has nothing for a module the engine merely reports", () => {
    // No folder anywhere, so no assets — not an error.
    expect(moduleAssetChoices(project, { extends: "@engine/nam" }, {})).toEqual(
      [],
    );
    expect(moduleAssetChoices(project, undefined, {})).toEqual([]);
  });

  it("cannot loop forever on a cyclic `extends`", () => {
    // Refused upstream; this is the backstop, and it must return rather than hang a UI request.
    const refs = {
      "@k7-core/a": { extends: "@k7-core/b" },
      "@k7-core/b": { extends: "@k7-core/a" },
    };
    expect(
      moduleAssetChoices(project, { extends: "@k7-core/a" }, refs),
    ).toEqual([]);
  });
});

describe("a file the module INHERITS", () => {
  it("resolves against the folder that holds it, not the one that named it", () => {
    // Resolved against the local folder alone, the merge kept the PARENT's path: the wrong sound.
    mkModule(join(libraries, "audio", "amps", "guitar"), NAM, [
      "roland/bright.nam",
      "fender/clean.nam",
    ]);
    mkNode("guitar", {
      extends: "@k7-core/audio/amps/guitar",
      params: { model: "roland/bright.nam" },
    });
    const refs = loadModuleRefs(project, {}, []);
    const resolved = resolveModuleMap(loadModules(project), refs);
    const g = resolved.guitar;
    expect(g?.assets).toEqual({ model: "roland/bright.nam" });
    expect(g?.model).toContain(join("amps", "guitar", "assets", "roland"));
  });

  it("prefers the module's OWN file when both carry that name", () => {
    mkModule(join(libraries, "audio", "amps", "shared"), NAM, ["clean.nam"]);
    mkNode(
      "local",
      { extends: "@k7-core/audio/amps/shared", params: { model: "clean.nam" } },
      ["clean.nam"],
    );
    const refs = loadModuleRefs(project, {}, []);
    const resolved = resolveModuleMap(loadModules(project), refs);
    const m = resolved.local;
    expect(m?.model).toContain(join("nodes", "assets"));
  });

  it("still refuses a ref that climbs out, rather than trying the next folder up", () => {
    // Walking the ancestry must not turn `../` into a way out: a shared module is somebody else's.
    mkModule(join(libraries, "audio", "amps", "shared"), NAM, ["clean.nam"]);
    mkNode("sneaky", {
      extends: "@k7-core/audio/amps/shared",
      params: { model: "../../../../secret.nam" },
    });
    const refs = loadModuleRefs(project, {}, []);
    const resolved = resolveModuleMap(loadModules(project), refs);
    const m = resolved.sneaky;
    expect(m?.model).toBeUndefined();
  });
});

describe("the extension a param takes", () => {
  it("comes from the param's own name", () => {
    expect(assetExtsFor("model")).toEqual([".nam", ".json"]);
    expect(assetExtsFor("onnx")).toEqual([".onnx"]);
  });

  it("filters a mixed assets/ down to what the param can load", () => {
    const files = ["a.nam", "b.NAM", "aida.json", "cab/v30.wav", "big.onnx"];
    expect(assetsForParam(files, "model")).toEqual([
      "a.nam",
      "b.NAM",
      "aida.json",
    ]);
    expect(assetsForParam(files, "onnx")).toEqual(["big.onnx"]);
  });

  it("filters by the FAMILY a panel names, for a slot whose name says nothing — a Faust table", () => {
    const files = [
      "@k7-core/akwf/fmsynth.wav",
      "@k7-core/basic.WAV",
      "notes.txt",
    ];
    // By its name alone, `Table` would ask for `.table` files and find none.
    expect(assetsForParam(files, "Table")).toEqual([]);
    expect(assetsForParam(files, "Table", "wavetables")).toEqual([
      "@k7-core/akwf/fmsynth.wav",
      "@k7-core/basic.WAV",
    ]);
  });
});
