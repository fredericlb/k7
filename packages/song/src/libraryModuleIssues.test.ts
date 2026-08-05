// A module of a shared library that fails its schema is dropped from the ref map — it has to
// be, the value is null. What it used to do besides that is NOTHING: no warning, no note, no
// trace. The failure then wears a different disguise depending on who asks next — "extends
// unknown module" about a file plainly on disk, a catalogue one row short, a song that played
// yesterday going quiet — and none of the three names the file that is actually wrong.
//
// Two bugs hid behind that silence in one afternoon, which is what these pin.

import {
  cpSync,
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

const SONG = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);

let ws: string;
let dir: string;

/** A module in the workspace's shared `_modules`. */
function sharedModule(rel: string, body: string): void {
  const at = join(ws, "_modules", rel);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "module.yaml"), body, "utf8");
}

const GOOD = "plugin:\n  type: internal\n  name: 4osc\n";
// `jsdsp:` as a KEY is the real one: the field moved into the plugin type, and every module
// still written the old way went quiet at once.
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
    // The REF, not a path: the file is outside the project, so a project-relative path would
    // point at nothing — and the ref is the name everything else in the app says.
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
    // The point of a warning rather than a throw: a library is a bag of modules this project
    // may never name, and one bad file must not take the others down with it.
    sharedModule("audio/broken", BAD);
    sharedModule("audio/fine", GOOD);
    const refs = loadModuleRefs(dir, {});
    expect(Object.keys(refs)).toEqual(["@workspace/audio/fine"]);
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
    // The message that sends you looking for a module that is not missing. The file is right
    // there; it is its CONTENT that is wrong, and only its own complaint says where.
    //
    // A real project, because this is the COMPILER's report: the fixture is one that already
    // plays, with one instance repointed at the broken library module.
    const song = join(ws, "demo");
    cpSync(SONG, song, { recursive: true });
    writeFileSync(
      join(song, "project.yaml"),
      // The fixture already declares an empty one — filled rather than added, or the file
      // would carry the key twice and fail to parse for a reason that has nothing to do
      // with what is being tested.
      readFileSync(join(song, "project.yaml"), "utf8").replace(
        /^(\s*)modules_from:.*$/m,
        "$1modules_from: [ ../_modules ]",
      ),
      "utf8",
    );
    sharedModule("audio/broken", BAD);
    writeFileSync(
      join(song, "instances", "lead.yaml"),
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
