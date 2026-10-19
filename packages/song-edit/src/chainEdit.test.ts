// Editing a library CHAIN with the verbs written for a project's graph.
//
// There is nothing to translate, and that is the point: a chain is a FOLDER holding a
// `graph.k7x` and a `nodes/`, which is exactly what a project holds. It differs in having no
// `project.k7x` and in naming its ends `@in`/`@out` — neither of which any graph verb reads.
//
// This file is what says so. It builds a chain as the library holds one and runs the project's
// own verbs at it; if editing a template ever needs a special case, one of these goes red.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectChainNodes, setModuleBypass } from "./projectEdit";

let dir: string;
const graph = () => readFileSync(join(dir, "graph.k7x"), "utf8");
const graphData = () =>
  parse(graph()) as {
    modules?: Record<string, string[]>;
    bypassed?: string[];
  };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chain-edit-"));
  // A template, as the library holds one: no project.k7x, ends named `@in` and `@out`.
  writeFileSync(
    join(dir, "graph.k7x"),
    'modules({ "@in": ["comp"], comp: ["@out"] })\n',
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", "comp.k7x"),
    'extends("@k7-core/audio/comp")\n',
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a chain template is edited by the graph's own verbs", () => {
  it("draws an arrow in it, with no project.k7x anywhere", () => {
    connectChainNodes(dir, "comp", "reverb");
    expect(graphData().modules?.comp).toContain("reverb");
  });

  it("bypasses a node in it", () => {
    setModuleBypass(dir, "comp", true);
    expect(graphData().bypassed).toContain("comp");
  });

  it("leaves the template's ENDS alone — they are what makes it a template", () => {
    connectChainNodes(dir, "comp", "reverb");
    const modules = graphData().modules ?? {};
    expect(modules["@in"]).toEqual(["comp"]);
    expect(modules.comp).toContain("@out");
  });

  it("refuses a folder with no graph file, naming what it wanted", () => {
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    try {
      expect(() => connectChainNodes(bare, "a", "b")).toThrow(/graph\.k7x/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
