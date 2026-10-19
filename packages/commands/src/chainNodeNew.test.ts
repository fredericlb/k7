// `node new` aimed at a CHAIN template. The builder's "+ nœud" button runs it with the chain's
// folder as `at`, and the claim it rests on is that the verb writes into THAT folder's `nodes/`
// — not the open song's. Untested, that claim was a comment; here it is a test.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeModule } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chain-new-"));
  // A template: a graph file and a nodes/, and NO project.k7x.
  writeDoc(join(dir, "graph.k7x"), { modules: { "@in": ["@out"] } });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeModule(dir, "audio", "comp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("node new, on a chain template", () => {
  it("writes the node into the CHAIN's nodes/, and puts it in its graph", async () => {
    await runCommand("node new audio/comp squash", host(), "cli");
    expect(String(wsData(join(dir, "nodes", "squash.k7x")).extends)).toContain(
      "audio/comp",
    );
    // …and in the graph, wired to nothing — what `node new` promises everywhere.
    const modules = wsData(join(dir, "graph.k7x")).modules as object;
    expect(Object.keys(modules)).toContain("squash");
  });
});
