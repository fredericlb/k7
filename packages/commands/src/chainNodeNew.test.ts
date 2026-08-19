// `node new` aimed at a CHAIN template. The builder's "+ nœud" button runs it with the chain's
// folder as `at`, and the claim it rests on is that the verb writes into THAT folder's `nodes/`
// — not the open song's. Untested, that claim was a comment; here it is a test.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // A template: a graph file and a nodes/, and NO project.yaml.
  writeFileSync(
    join(dir, "graph.yaml"),
    'modules:\n  "@in": [ "@out" ]\n',
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  const md = join(dir, "modules", "audio", "comp");
  mkdirSync(md, { recursive: true });
  writeFileSync(
    join(md, "module.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("node new, on a chain template", () => {
  it("writes the node into the CHAIN's nodes/, and puts it in its graph", () => {
    return runCommand("node new audio/comp squash", host(), "cli").then(() => {
      expect(readFileSync(join(dir, "nodes", "squash.yaml"), "utf8")).toContain(
        "audio/comp",
      );
      // …and in the graph, wired to nothing — what `node new` promises everywhere.
      expect(readFileSync(join(dir, "graph.yaml"), "utf8")).toMatch(/squash:/);
    });
  });
});
