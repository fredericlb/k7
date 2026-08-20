// What a file-valued param may be set to. The case that matters is INHERITANCE: a song points at
// a shared amp with a thin local module that extends it, and the files live in the shared folder.
// Looking only under `<project>/modules/<category>/<file>/assets` listed nothing for exactly that
// shape — see docs/filePicker.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModuleRefs, loadModules } from "./loader";
import { moduleAssetChoices } from "./moduleAssetChoices";
import { resolveModuleMap } from "./moduleResolve";
import { assetExtFor, assetsForParam } from "./moduleTypes";

let root: string;
let project: string;
/** The `@st0` library, mounted in the workspace beside the project — `<ws>/_libraries/modules`. */
let libraries: string;

// A module folder with a module.yaml (which is what makes it findable by ref) and some assets.
const mkModule = (dir: string, yaml: string, assets: string[] = []) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "module.yaml"), yaml, "utf8");
  for (const a of assets) {
    const abs = join(dir, "assets", a);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "x", "utf8");
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "assets-"));
  project = join(root, "ws", "song.st0");
  libraries = join(root, "ws", "_libraries", "modules");
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("moduleAssetChoices", () => {
  it("lists the module's own assets", () => {
    mkModule(
      join(project, "modules", "audio", "amp"),
      "plugin: { type: internal, name: X }\n",
      ["jcm800.nam", "Two-Rock/clean.nam"],
    );
    expect(
      moduleAssetChoices(project, { category: "audio", file: "amp" }, {}),
    ).toEqual(["Two-Rock/clean.nam", "jcm800.nam"]);
  });

  it("INHERITS the assets of what it extends, wherever that library is", () => {
    // The guitar case: the project's module is a shell, and the one in the workspace's
    // `_libraries/modules` submodule — the `@st0` level — carries the profiles.
    mkModule(
      join(libraries, "audio", "amps", "guitar"),
      "plugin: { type: internal, name: NAM }\n",
      ["roland/bright.nam", "fender/clean.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "guitar"),
      'extends: "@st0/audio/amps/guitar"\n',
    );
    // Through the real loaders, because the FOLDER each module lives in is something they
    // stamp — reading it off the ref map is what keeps this from walking the libraries again.
    const refs = loadModuleRefs(project, {}, []);
    const mod = loadModules(project).guitar;
    const choices = moduleAssetChoices(project, mod, refs);
    // Its own folder holds none; every choice comes from the ancestor.
    expect(choices.sort()).toEqual(["fender/clean.nam", "roland/bright.nam"]);
  });

  it("walks more than one level, following each ref's own `extends`", () => {
    mkModule(
      join(libraries, "audio", "amps", "base"),
      "plugin: { type: internal, name: NAM }\n",
      ["deep.nam"],
    );
    mkModule(
      join(libraries, "audio", "amps", "mid"),
      'extends: "@st0/audio/amps/base"\n',
      ["mid.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "top"),
      'extends: "@st0/audio/amps/mid"\n',
    );
    const refs = loadModuleRefs(project, {}, []);
    const choices = moduleAssetChoices(project, loadModules(project).top, refs);
    // Nearest first: `mid`'s own, then what IT inherits, two links up.
    expect(choices).toEqual(["mid.nam", "deep.nam"]);
  });

  it("lets a nearer file shadow an inherited one of the same name", () => {
    mkModule(
      join(libraries, "audio", "amps", "shared"),
      "plugin: { type: internal, name: NAM }\n",
      ["clean.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "local"),
      'extends: "@st0/audio/amps/shared"\n',
      ["clean.nam"],
    );
    expect(
      moduleAssetChoices(
        project,
        {
          category: "audio",
          file: "local",
          extends: "@st0/audio/amps/shared",
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
      "@st0/a": { extends: "@st0/b" },
      "@st0/b": { extends: "@st0/a" },
    };
    expect(moduleAssetChoices(project, { extends: "@st0/a" }, refs)).toEqual(
      [],
    );
  });
});

describe("a file the module INHERITS", () => {
  it("resolves against the folder that holds it, not the one that named it", () => {
    // Picking a profile for a shared amp writes the ref into the LOCAL module, whose own
    // assets/ is empty. Resolved against that folder alone it came back undefined, and the
    // merge then kept the PARENT's path — the panel showed the chosen name while the engine
    // loaded the inherited file. Silently the wrong sound.
    mkModule(
      join(libraries, "audio", "amps", "guitar"),
      "plugin: { type: internal, name: NAM }\n",
      ["roland/bright.nam", "fender/clean.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "guitar"),
      'extends: "@st0/audio/amps/guitar"\nparams:\n  nam: roland/bright.nam\n',
    );
    const refs = loadModuleRefs(project, {}, []);
    const resolved = resolveModuleMap(loadModules(project), refs);
    const g = resolved["audio/guitar"] ?? resolved.guitar;
    expect(g?.assets).toEqual({ nam: "roland/bright.nam" });
    expect(g?.nam).toContain(join("amps", "guitar", "assets", "roland"));
  });

  it("prefers the module's OWN file when both carry that name", () => {
    mkModule(
      join(libraries, "audio", "amps", "shared"),
      "plugin: { type: internal, name: NAM }\n",
      ["clean.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "local"),
      'extends: "@st0/audio/amps/shared"\nparams:\n  nam: clean.nam\n',
      ["clean.nam"],
    );
    const refs = loadModuleRefs(project, {}, []);
    const resolved = resolveModuleMap(loadModules(project), refs);
    const m = resolved["audio/local"] ?? resolved.local;
    expect(m?.nam).toContain(join("modules", "audio", "local"));
  });

  it("still refuses a ref that climbs out, rather than trying the next folder up", () => {
    // Escaping is a property of the REF. Walking the ancestry must not turn `../` into a way
    // through — a module that arrives from a shared catalogue was written by somebody else.
    mkModule(
      join(libraries, "audio", "amps", "shared"),
      "plugin: { type: internal, name: NAM }\n",
      ["clean.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "sneaky"),
      'extends: "@st0/audio/amps/shared"\nparams:\n  nam: ../../../../secret.nam\n',
    );
    const refs = loadModuleRefs(project, {}, []);
    const resolved = resolveModuleMap(loadModules(project), refs);
    const m = resolved["audio/sneaky"] ?? resolved.sneaky;
    expect(m?.nam).toBeUndefined();
  });
});

describe("the extension a param takes", () => {
  it("comes from the param's own name", () => {
    expect(assetExtFor("nam")).toBe(".nam");
    expect(assetExtFor("onnx")).toBe(".onnx");
  });

  it("filters a mixed assets/ down to what the param can load", () => {
    const files = ["a.nam", "b.NAM", "cab/v30.wav", "big.onnx"];
    expect(assetsForParam(files, "nam")).toEqual(["a.nam", "b.NAM"]);
    expect(assetsForParam(files, "onnx")).toEqual(["big.onnx"]);
  });
});
