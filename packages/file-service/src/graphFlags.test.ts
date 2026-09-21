// The plugin-state flags, on the two modules that have no plugin to be missing: a SHADER carries
// GLSL and a SHAPE carries params, so neither has a slot an empty `plugin:` could be a hole in.
// Drawn red and captioned "missing plugin" without this. See docs/graphFlags.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flags-"));
  dir = join(root, "song.st0");
  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    'project:\n  name: "f"\n  viewport: [1280, 720, 30]\n  layers: [main]\n',
  );
  writeFileSync(join(dir, "video_tracks", "main.yaml"), "events: []\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** One module in the type folder that decides what it IS. */
function module(category: string, name: string, body: string) {
  mkdirSync(join(dir, "modules", category, name), { recursive: true });
  writeFileSync(join(dir, "modules", category, name, "module.yaml"), body);
}

/** The step this graph put on a chain, whichever chain that turned out to be. */
function step(name: string) {
  const g = buildGraphDoc(dir);
  return Object.values(g.chains)
    .flatMap((c) => c.use)
    .find((s) => s.module === name);
}

describe("a module that IS its behaviour", () => {
  it("is no stub, and gets no engine address either", () => {
    module("shaders", "glow", "type: shader\nshader: pulse\n");
    module("shapes", "box", "type: shape\nshape: square\nparams:\n  w: 10\n");
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  box: [ main ]\n  main: [ glow ]\n  glow: [ RENDER ]\n  RENDER: [ VIDEO_OUT ]\n",
    );

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
    mkdirSync(join(root, "_modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "amp", "module.yaml"),
      "params:\n  gain: 1\n",
    );
    mkdirSync(join(dir, "nodes"), { recursive: true });
    writeFileSync(
      join(dir, "nodes", "amp.yaml"),
      'extends: "@workspace/audio/amp"\n',
    );
    // Fed by a live input, an `audio` module's flow port being mandatory — the amp is the subject.
    writeFileSync(
      join(dir, "nodes", "gtr.yaml"),
      'extends: "@engine/IN"\nchannel: [1]\n',
    );
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n  RENDER: [ VIDEO_OUT ]\n",
    );

    expect(step("amp")?.stub).toBe(true);
  });
});
