// A module of a shared library that fails its schema is dropped from the ref map — it has to
// be, the value is null. Dropping it in silence is the danger: no warning, no note, no trace,
// and the failure then wears a different disguise depending on who asks next — "extends unknown
// module" about a file plainly on disk, a catalogue one row short, a song going quiet — none of
// which names the file that is actually wrong. These pin the diagnostic instead.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryModuleIssues, loadModuleRefs } from "./loader";
import { compileNodeProject } from "./nodeProject";
import { copyAsYaml } from "./testSupport";

const DEMOS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "demos",
);
const SONG = join(DEMOS, "synth-demo.st0");

let ws: string;
let dir: string;

/** A module in the workspace's shared `_modules`. */
function sharedModule(rel: string, body: string): void {
  const at = join(ws, "_modules", rel);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "module.yaml"), body, "utf8");
}

const GOOD = "plugin:\n  type: internal\n  name: 4osc\n";
// `jsdsp:` as a KEY is the real one: the field belongs to the plugin type, so a module spelling it here fails.
const BAD = "plugin:\n  type: internal\n  name: 4osc\njsdsp: auto-wah.ts\n";

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-libissue-"));
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n  modules_from:\n    - ../_modules\n",
    "utf8",
  );
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a library module that will not read", () => {
  it("is reported, naming the module by the ref a chain would use", () => {
    sharedModule("audio/broken", BAD);
    const [issue, ...rest] = libraryModuleIssues(dir);
    expect(rest).toEqual([]);
    // The REF, not a path: the file is outside the project, so a relative path points at nothing.
    expect(issue.file).toBe("@workspace/audio/broken/module.yaml");
    expect(issue.severity).toBe("warning");
    expect(issue.message).toContain("did not load");
    expect(issue.message).toContain("jsdsp"); // the file's OWN complaint, not a paraphrase
  });

  it("says nothing about a library that reads", () => {
    sharedModule("audio/fine", GOOD);
    expect(libraryModuleIssues(dir)).toEqual([]);
  });

  it("costs that module and no other", () => {
    // A warning and not a throw: this project may never name the module that is broken.
    sharedModule("audio/broken", BAD);
    sharedModule("audio/fine", GOOD);
    const refs = loadModuleRefs(dir, {});
    // `@meta/…` is dropped like the catalogue: this asks what the FILES define.
    expect(Object.keys(refs).filter((r) => !r.startsWith("@meta/"))).toEqual([
      "@workspace/audio/fine",
    ]);
    expect(libraryModuleIssues(dir)).toHaveLength(1);
  });

  it("is a WARNING, since nothing here names it", () => {
    sharedModule("audio/broken", BAD);
    expect(
      libraryModuleIssues(dir).every((i) => i.severity === "warning"),
    ).toBe(true);
  });
});

describe("…and when a module DOES name it", () => {
  it("says the ref failed to load, rather than that it is unknown", () => {
    // "unknown module" sends you looking for a file that is there with wrong CONTENT.
    const song = join(ws, "demo");
    copyAsYaml(SONG, song, { recursive: true });
    // The Examples workspace's own shared library, beside every demo project.
    copyAsYaml(join(DEMOS, "_modules"), join(ws, "_modules"), {
      recursive: true,
    });
    writeFileSync(
      join(song, "project.yaml"),
      // Filled rather than added: a second key would fail to parse for an unrelated reason.
      readFileSync(join(song, "project.yaml"), "utf8").replace(
        /^(\s*)modules_from:.*$/m,
        "$1modules_from: [ ../_modules ]",
      ),
      "utf8",
    );
    sharedModule("audio/broken", BAD);
    writeFileSync(
      join(song, "nodes", "lead.yaml"),
      'extends: "@workspace/audio/broken"\n',
      "utf8",
    );

    let message = "";
    try {
      compileNodeProject(song);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("@workspace/audio/broken");
    expect(message).toContain("did not load");
    expect(message).toContain("jsdsp"); // the file's own words, carried all the way up
    expect(message).not.toContain("unknown module");
  });
});
