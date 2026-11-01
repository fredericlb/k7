// RENDER's sound input: the mix wired into `RENDER#audio` ONCE, at the open that first reaches level 5,
// in a graph and in a chain project; what the graph refuses to feed it. See docs/videoOutputs.md.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RENDER_AUDIO_LEVEL } from "@studio/song-schema/formatLevel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { validateIssues } from "./graphValidate";
import { asChainProject } from "./scaffold";
import { writeDoc } from "./testSupport";
import { ensureVideoRun } from "./videoOutputs";
import { wsData } from "./yaml/workspaceDoc";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "render-sound-"));
  dir = join(root, "song.k7");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A video project at `format` with this graph text. */
function project(graph: string, format?: number): void {
  writeDoc(join(dir, "project.k7x"), {
    ...(format ? { format } : {}),
    project: { name: "t", tempo: 120 },
  });
  writeFileSync(join(dir, "graph.k7x"), graph, "utf8");
}

const mixOut = () => loadGraph(dir).chains.MIX?.out.map((o) => o.to);
const level = () => wsData(join(dir, "project.k7x")).format;

describe("the open wires the mix into RENDER's sound once", () => {
  it("adds the arrow to an older project and stamps it", () => {
    project('modules({ MIX: ["OUT"], RENDER: ["VIDEO_OUT"] })\n');
    ensureVideoRun(dir);
    expect(mixOut()).toEqual(["OUT", "RENDER#audio"]);
    expect(level()).toBe(RENDER_AUDIO_LEVEL);
  });

  it("never wires it again once unwired: the level says the choice was made", () => {
    project(
      'modules({ MIX: ["OUT"], RENDER: ["VIDEO_OUT"] })\n',
      RENDER_AUDIO_LEVEL,
    );
    const before = readFileSync(join(dir, "graph.k7x"), "utf8");
    ensureVideoRun(dir);
    expect(readFileSync(join(dir, "graph.k7x"), "utf8")).toBe(before);
  });

  it("keeps an arrow already there, written once", () => {
    project(
      'modules({ MIX: ["OUT", "RENDER#audio"], RENDER: ["VIDEO_OUT"] })\n',
    );
    ensureVideoRun(dir);
    expect(mixOut()).toEqual(["OUT", "RENDER#audio"]);
  });

  it("does the same in a chain project, its port kept on the link", () => {
    project('modules({ MIX: ["OUT"], RENDER: ["VIDEO_OUT"] })\n', 4);
    asChainProject(dir);
    ensureVideoRun(dir);
    expect(mixOut()).toEqual(["OUT", "RENDER#audio"]);
    expect(level()).toBe(RENDER_AUDIO_LEVEL);
  });
});

describe("what RENDER's inputs take", () => {
  const codes = () => validateIssues(loadGraph(dir)).map((w) => w.code);

  it("takes the mix on its sound input, quietly", () => {
    project(
      'modules({ MIX: ["OUT", "RENDER#audio"], RENDER: ["VIDEO_OUT"] })\n',
    );
    expect(codes()).toEqual([]);
  });

  it("says a lane's sound there is not in the export, and names a port it does not have", () => {
    writeDoc(join(dir, "nodes", "gtr.k7x"), { extends: "@meta/track" });
    project(
      'modules({ gtr: ["MIX", "RENDER#audio"], MIX: ["OUT", "RENDER#side"], RENDER: ["VIDEO_OUT"] })\n',
    );
    expect(codes()).toEqual(["outRenderSoundNotMix", "outRenderPort"]);
  });
});
