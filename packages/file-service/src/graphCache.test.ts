// The routing graph is memoised, and a memo is only ever as good as the thing that invalidates it.
//
// Building the graph reads the whole song (~280 ms on a real one) and the Chains tab refetches after every
// command, so the win is large — but a graph that keeps showing a chain the user just rewrote is worse than a
// slow one. It is keyed on the revision token, which moves for our own writes AND for an edit made behind the
// service's back; both directions are checked here, because only the first is easy.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeLibrary, writeNode } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let proj: string;
let ws: Workspace;

// gtr -> steps[0] -> … -> OUT, as segments: one node per line.
const chains = (...steps: string[]) =>
  `modules({\n  gtr: ["${steps[0] ?? "OUT"}"],\n${steps
    .map((s, i) => `  ${s}: ["${steps[i + 1] ?? "OUT"}"],\n`)
    .join("")}})\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-gcache-"));
  proj = join(root, "song.k7");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeDoc(join(proj, "project.k7x"), { project: { name: "song" } });
  writeFileSync(join(proj, "graph.k7x"), chains("amp"), "utf8");
  writeNode(proj, "gtr", { extends: "@meta/track", events: [] });
  // The modules live at `@workspace` now; "amp"/"cab" stay the bare NODE names the graph uses.
  writeLibrary(root, {
    "audio/amp": { plugin: { type: "internal", name: "Chorus" } },
    "audio/cab": { plugin: { type: "internal", name: "Chorus" } },
  });
  writeNode(proj, "amp", { extends: "@workspace/audio/amp" });
  writeNode(proj, "cab", { extends: "@workspace/audio/cab" });
  ws = new Workspace(root);
  ws.setActiveProject("song.k7");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const steps = () =>
  Object.values(ws.graphDoc().chains)[0].use.map((s) => s.module);

describe("the graph memo", () => {
  it("hands back the same object while nothing has changed", () => {
    // Identity, not equality: a fresh build would be a different object, so this is what proves the memo ran.
    const a = ws.graphDoc();
    expect(ws.graphDoc()).toBe(a);
  });

  it("rebuilds after a write through the service", () => {
    expect(steps()).toEqual(["amp"]);
    ws.write("song.k7/graph.k7x", chains("amp", "cab"));
    expect(steps()).toEqual(["amp", "cab"]);
  });

  it("rebuilds after an edit made BEHIND the service's back", async () => {
    // The case a mutation counter cannot see; the token notices via the file count and newest mtime.
    expect(steps()).toEqual(["amp"]);
    await new Promise((r) => setTimeout(r, 12)); // mtime resolution — the write must land in a later tick
    writeFileSync(join(proj, "graph.k7x"), chains("amp", "cab"), "utf8");
    expect(steps()).toEqual(["amp", "cab"]);
  });

  it("notices a project file appearing, not just changing", async () => {
    const before = ws.graphDoc();
    await new Promise((r) => setTimeout(r, 12));
    // A NOTE, a node of the built-in `@meta/doc` — a file that APPEARS must invalidate the memo.
    writeNode(proj, "fuzz", {
      extends: "@meta/doc",
      content: "watch the gain here",
    });
    expect(ws.graphDoc()).not.toBe(before);
    expect(ws.graphDoc().modules).toHaveProperty("fuzz");
  });
});
