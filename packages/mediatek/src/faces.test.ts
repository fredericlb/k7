import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extendedRefs } from "./faces.ts";
import { ensureLayout } from "./layout.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-faces-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});

afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, body: string): void => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
};

describe("extendedRefs", () => {
  it("reports what every module extends, at any depth", () => {
    write(
      "modules/audio/distortion/bitcrush/module.yaml",
      'extends: "@engine/de-rez"\n',
    );
    write(
      "modules/audio/utility/mixer/module.yaml",
      'extends: "@engine/mixer"\n',
    );
    expect([...extendedRefs()].sort()).toEqual([
      "@engine/de-rez",
      "@engine/mixer",
    ]);
  });

  it("says nothing about a module that extends nothing", () => {
    // The real library holds one: `extends: ""` on a module built from its own assets.
    write("modules/audio/amps/guitar/module.yaml", 'extends: ""\nplugin: {}\n');
    write("modules/audio/fuzz/module.yaml", "plugin: {}\n");
    expect([...extendedRefs()]).toEqual([]);
  });

  it("answers short rather than throwing on a file somebody broke", () => {
    // This reads a folder people edit by hand. A library that refused to answer because one
    // file has a stray tab would be worse than one that answers short — it is the same
    // tolerance the scan beside it keeps.
    write("modules/audio/ok/module.yaml", 'extends: "@engine/ok"\n');
    write("modules/audio/broken/module.yaml", "extends: [unclosed\n");
    expect([...extendedRefs()]).toEqual(["@engine/ok"]);
  });
});
