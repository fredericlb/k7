// A library's folder chains rewritten as chain files. What is proved: the file runs the steps the
// folder declared (a `tracks:` graph included, which the folder reader reads as nothing), comments
// survive, presets move to the library's `vstpresets/`, and what is not one run is refused.

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
import { libraryChainDirs, readTemplate } from "./libraryChains.ts";
import {
  applyConversion,
  convertFolderChain,
  folderChains,
} from "./libraryChainsMigrate.ts";
import { librariesFixture } from "./testSupport";

let root: string;
let lib: string;

const put = (rel: string, text: string): void => {
  mkdirSync(join(lib, rel, ".."), { recursive: true });
  writeFileSync(join(lib, rel), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chains-migrate-"));
  lib = librariesFixture(root);
  put(
    "chains/vocals/warm/graph.yaml",
    '# Warm vocals.\n#\n# `@in` and `@out` are the ends of a template.\ntracks:\n  "@in": [ comp ]\nmodules:\n  comp: [ eq ]\n  eq: [ "@out" ]\nbypassed: [ eq ]\n',
  );
  put(
    "chains/vocals/warm/nodes/comp.yaml",
    '# The comp.\nextends: "@k7-core/audio/comp"\nparams:\n  # Half.\n  Ratio: 0.5\n',
  );
  put("chains/vocals/warm/nodes/eq.yaml", 'extends: "@k7-core/audio/eq"\n');
  put("chains/vocals/warm/nodes/comp.vstpreset", "state");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("migrating a library's folder chains", () => {
  it("writes one file running the steps the folder declared", () => {
    const [c] = folderChains("k7-core", lib);
    // The folder reader refuses a `tracks:` graph, which is why the run is the truth.
    expect(readTemplate(c).steps).toEqual([]);
    const cv = convertFolderChain(c);
    expect(cv.ids.map(([n]) => n)).toEqual(["comp", "eq"]);
    applyConversion(cv);
    expect(existsSync(join(lib, "chains/vocals/warm"))).toBe(false);
    const [file] = libraryChainDirs();
    expect(file.layout).toBe("file");
    const { steps } = readTemplate(file);
    expect(steps.map((s) => [s.module, !!s.bypass])).toEqual([
      [{ extends: "@k7-core/audio/comp", params: { Ratio: 0.5 } }, false],
      [{ extends: "@k7-core/audio/eq" }, true],
    ]);
    expect(steps.map((s) => s.name)).toEqual(cv.ids.map(([, id]) => id));
  });

  it("keeps the comments, less the paragraph about the old ends", () => {
    const cv = convertFolderChain(folderChains("k7-core", lib)[0]);
    expect(cv.text).toContain("# Warm vocals.");
    expect(cv.text).not.toContain("`@in`");
    expect(cv.text).toContain("# The comp.");
    expect(cv.text).toContain("# Half.");
    expect(cv.text).toContain('- to: [ { chain: "@out" } ]');
  });

  it("moves a node's preset to the library's vstpresets/, under its id", () => {
    const cv = convertFolderChain(folderChains("k7-core", lib)[0]);
    applyConversion(cv);
    const comp = cv.ids[0][1];
    expect(
      readFileSync(join(lib, "vstpresets", `${comp}.vstpreset`), "utf8"),
    ).toBe("state");
    expect(readTemplate(libraryChainDirs()[0]).steps[0].preset).toBe(
      join(lib, "vstpresets", `${comp}.vstpreset`),
    );
  });

  it("refuses what is not one run, and what a file has no place for", () => {
    put(
      "chains/split/graph.yaml",
      'modules:\n  "@in": [ a, b ]\n  a: [ "@out" ]\n  b: [ "@out" ]\n',
    );
    put("chains/split/nodes/a.yaml", "extends: x\n");
    put("chains/split/nodes/b.yaml", "extends: x\n");
    put("chains/vocals/warm/notes.md", "hello\n");
    const [split, warm] = folderChains("k7-core", lib);
    expect(() => convertFolderChain(split)).toThrow(/not one run/);
    expect(() => convertFolderChain(warm)).toThrow(/notes\.md/);
  });
});
