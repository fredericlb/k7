// The plugin-state flags, on the two modules that have no plugin to be missing: a SHADER carries
// GLSL and a SHAPE carries params, so neither has a slot an empty `plugin` could be a hole in.
// Drawn red and captioned "missing plugin" without this. See docs/graphFlags.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeNode } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flags-"));
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), {
    project: { name: "f", viewport: [1280, 720, 30] },
  });
  writeDoc(join(dir, "nodes", "main.k7x"), {
    extends: "@meta/picture-track",
    events: [],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** One module in the type folder that decides what it IS. */
function module(category: string, name: string, body: Record<string, unknown>) {
  writeDoc(join(dir, "modules", category, name, "module.k7x"), body);
}

/** The graph's segments. */
const graph = (modules: Record<string, string[]>) =>
  writeDoc(join(dir, "graph.k7x"), { modules });

/** The step this graph put on a chain, whichever chain that turned out to be. */
function step(name: string) {
  const g = buildGraphDoc(dir);
  return Object.values(g.chains)
    .flatMap((c) => c.use)
    .find((s) => s.module === name);
}

describe("a module that IS its behaviour", () => {
  it("is no stub, and gets no engine address either", () => {
    module("shaders", "glow", { type: "shader", shader: "pulse" });
    module("shapes", "box", {
      type: "shape",
      shape: "square",
      params: { w: 10 },
    });
    graph({
      box: ["main"],
      main: ["glow"],
      glow: ["RENDER"],
      RENDER: ["VIDEO_OUT"],
    });

    for (const name of ["glow", "box"]) {
      const s = step(name);
      expect(s, `${name} is on a chain`).toBeDefined();
      expect(s?.stub, `${name} is not a missing plugin`).toBeFalsy();
      // It runs in the BROWSER: an address here would name a plugin no engine has.
      expect(s?.pluginId, `${name} has no engine address`).toBeUndefined();
    }
  });

  it("leaves a real plugin slot with no plugin flagged, which is what the flag is for", () => {
    // A module lives at `@workspace` now; "amp" stays the bare NODE name the graph uses.
    writeDoc(join(root, "_modules", "audio", "amp", "module.k7x"), {
      params: { gain: 1 },
    });
    writeNode(dir, "amp", { extends: "@workspace/audio/amp" });
    // Fed by a live input, an `audio` module's flow port being mandatory — the amp is the subject.
    writeNode(dir, "gtr", { extends: "@meta/IN", channel: [1] });
    graph({ gtr: ["amp"], amp: ["OUT"], RENDER: ["VIDEO_OUT"] });

    expect(step("amp")?.stub).toBe(true);
  });
});
