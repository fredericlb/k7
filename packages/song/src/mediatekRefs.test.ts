// What a machine has to fetch from the hosted library: the médiathèque modules a project
// NAMES, found in the files rather than in the resolved ref map — the ones worth fetching are
// exactly those the loader cannot resolve yet.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mediatekPathPrefix, mediatekRefs } from "./mediatekRefs";
import { librariesFixture, writeDoc, writeNode } from "./testSupport";

let ws: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-mref-"));
  dir = join(ws, "song");
  writeDoc(join(dir, "project.k7x"), {
    project: { name: "song", tempo: 120 },
  });
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe("the médiathèque modules a project names", () => {
  it("finds the ones a NODE extends — the ordinary way to use one", () => {
    // A node reaches the library through `extends`, and missing it leaves the module uncached.
    writeNode(dir, "gtr", { extends: "@k7-core/audio/filter/auto-wah" });
    expect(mediatekRefs(dir)).toEqual(["@k7-core/audio/filter/auto-wah"]);
  });

  it("finds one a chain step names outright, node and all", () => {
    // The folder to fetch is the MODULE's, so the node suffix is dropped rather than pathed.
    writeDoc(join(dir, "graph.k7x"), {
      modules: { gtr: ["@k7-core/audio/modulation/flanger:warm"] },
    });
    expect(mediatekRefs(dir)).toEqual(["@k7-core/audio/modulation/flanger"]);
  });

  it("ignores every other level", () => {
    // `@workspace` and `@engine` are folders this machine already has, so nothing is fetched.
    writeNode(dir, "a", { extends: "@workspace/audio/thing" });
    writeNode(dir, "b", { extends: "@engine/serum" });
    writeNode(dir, "c", { plugin: { type: "internal" } });
    expect(mediatekRefs(dir)).toEqual([]);
  });

  it("follows what a library module extends in turn", () => {
    // Fetching a child alone lands a module whose substance is in a parent nobody asked for.
    const at = join(librariesFixture(ws), "modules", "audio", "amp", "child");
    writeDoc(join(at, "module.k7x"), { extends: "@k7-core/audio/amp/base" });
    writeNode(dir, "mine", { extends: "@k7-core/audio/amp/child" });
    expect(mediatekRefs(dir)).toEqual([
      "@k7-core/audio/amp/base",
      "@k7-core/audio/amp/child",
    ]);
  });

  it("maps a ref to the folder the whole module lives in", () => {
    // A module IS its folder — the jsdsp source, the presets and the panel come with it.
    expect(mediatekPathPrefix("@k7-core/audio/filter/auto-wah")).toBe(
      "modules/audio/filter/auto-wah/",
    );
  });
});
