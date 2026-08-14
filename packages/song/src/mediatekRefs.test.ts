// What a machine has to fetch from the hosted library: the médiathèque modules a project
// NAMES, found in the files rather than in the resolved ref map — the ones worth fetching are
// exactly those the loader cannot resolve yet.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mediatekPathPrefix, mediatekRefs } from "./mediatekRefs";

let ws: string;
let dir: string;
let media: string;

/** A module file in the project's own `modules/`. */
function projectModule(rel: string, body: string): void {
  const at = join(dir, "modules", rel);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "module.yaml"), body, "utf8");
}

/** One USE of a module, in the project's flat `nodes/`. */
function projectNode(name: string, body: string): void {
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "nodes", `${name}.yaml`), body, "utf8");
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-mref-"));
  media = mkdtempSync(join(tmpdir(), "td-mref-media-"));
  process.env.STUDIO_MEDIATEK = media;
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(ws, { recursive: true, force: true });
  rmSync(media, { recursive: true, force: true });
});

describe("the médiathèque modules a project names", () => {
  it("finds the ones its own modules extend", () => {
    projectModule("audio/wah", 'extends: "@st0/audio/filter/auto-wah"\n');
    expect(mediatekRefs(dir)).toEqual(["@st0/audio/filter/auto-wah"]);
  });

  it("finds the ones a NODE extends — the ordinary way to use one", () => {
    // A use of a library module is a file in `nodes/` now, and it reaches the library
    // through `extends` like anything else. Missing it here would mean the machine never
    // cached the module its own song plays.
    projectNode("gtr", 'extends: "@st0/audio/filter/auto-wah"\n');
    expect(mediatekRefs(dir)).toEqual(["@st0/audio/filter/auto-wah"]);
  });

  it("finds one a chain step names outright, node and all", () => {
    // A chain may reach a library module directly; the folder to fetch is the module's, so
    // the node suffix is dropped rather than turned into a path nothing answers to.
    writeFileSync(
      join(dir, "chains.yaml"),
      "modules:\n  gtr: [ '@st0/audio/modulation/flanger:warm' ]\n",
      "utf8",
    );
    expect(mediatekRefs(dir)).toEqual(["@st0/audio/modulation/flanger"]);
  });

  it("ignores every other level", () => {
    // `@workspace` and `@project` are folders this machine already has; fetching them from
    // the hosted library would be asking someone else for our own files.
    projectModule("audio/a", 'extends: "@workspace/audio/thing"\n');
    projectModule("audio/b", 'extends: "@engine/serum"\n');
    projectModule("audio/c", "plugin: {type: internal}\n");
    expect(mediatekRefs(dir)).toEqual([]);
  });

  it("follows what a library module extends in turn", () => {
    // Inheritance is how the library builds on itself, so fetching the child alone lands a
    // module whose substance is in a parent nobody asked for.
    const at = join(media, "modules", "audio", "amp", "child");
    mkdirSync(at, { recursive: true });
    writeFileSync(
      join(at, "module.yaml"),
      'extends: "@st0/audio/amp/base"\n',
      "utf8",
    );
    projectModule("audio/mine", 'extends: "@st0/audio/amp/child"\n');
    expect(mediatekRefs(dir)).toEqual([
      "@st0/audio/amp/base",
      "@st0/audio/amp/child",
    ]);
  });

  it("maps a ref to the folder the whole module lives in", () => {
    // A module IS its folder — the jsdsp source, the presets and the panel come with it.
    expect(mediatekPathPrefix("@st0/audio/filter/auto-wah")).toBe(
      "modules/audio/filter/auto-wah/",
    );
  });
});
