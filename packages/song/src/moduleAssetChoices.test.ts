// What a file-valued param may be set to. The case that matters is INHERITANCE: a song points at
// a shared amp with a thin local module that extends it, and the files live in the shared folder.
// Looking only under `<project>/modules/<category>/<file>/assets` listed nothing for exactly that
// shape — see docs/filePicker.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moduleAssetChoices } from "./moduleAssetChoices";
import { assetExtFor, assetsForParam } from "./moduleTypes";

let root: string;
let project: string;

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
  process.env.STUDIO_MEDIATEK = join(root, "mediatek");
  project = join(root, "ws", "song.l8");
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  process.env.STUDIO_MEDIATEK = undefined;
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
    // The guitar case: the project's module is a shell, the médiathèque's carries the profiles.
    mkModule(
      join(root, "mediatek", "modules", "audio", "amps", "guitar"),
      "plugin: { type: internal, name: NAM }\n",
      ["roland/bright.nam", "fender/clean.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "guitar"),
      'extends: "@mediatek/audio/amps/guitar"\n',
    );
    const choices = moduleAssetChoices(
      project,
      {
        category: "audio",
        file: "guitar",
        extends: "@mediatek/audio/amps/guitar",
      },
      {},
    );
    // Its own folder holds none; every choice comes from the ancestor.
    expect(choices.sort()).toEqual(["fender/clean.nam", "roland/bright.nam"]);
  });

  it("walks more than one level, following each ref's own `extends`", () => {
    mkModule(
      join(root, "mediatek", "modules", "audio", "amps", "base"),
      "plugin: { type: internal, name: NAM }\n",
      ["deep.nam"],
    );
    mkModule(
      join(root, "mediatek", "modules", "audio", "amps", "mid"),
      'extends: "@mediatek/audio/amps/base"\n',
      ["mid.nam"],
    );
    const refs = {
      "@mediatek/audio/amps/mid": { extends: "@mediatek/audio/amps/base" },
    };
    const choices = moduleAssetChoices(
      project,
      { extends: "@mediatek/audio/amps/mid" },
      refs,
    );
    // Nearest first: `mid`'s own, then what it inherits.
    expect(choices).toEqual(["mid.nam", "deep.nam"]);
  });

  it("lets a nearer file shadow an inherited one of the same name", () => {
    mkModule(
      join(root, "mediatek", "modules", "audio", "amps", "shared"),
      "plugin: { type: internal, name: NAM }\n",
      ["clean.nam"],
    );
    mkModule(
      join(project, "modules", "audio", "local"),
      'extends: "@mediatek/audio/amps/shared"\n',
      ["clean.nam"],
    );
    expect(
      moduleAssetChoices(
        project,
        {
          category: "audio",
          file: "local",
          extends: "@mediatek/audio/amps/shared",
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
      "@mediatek/a": { extends: "@mediatek/b" },
      "@mediatek/b": { extends: "@mediatek/a" },
    };
    expect(
      moduleAssetChoices(project, { extends: "@mediatek/a" }, refs),
    ).toEqual([]);
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
