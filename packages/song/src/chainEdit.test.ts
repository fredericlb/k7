// Editing a library CHAIN with the verbs written for a project's graph.
//
// There is nothing to translate, and that is the point: a chain is a FOLDER holding a
// `graph.yaml` and a `nodes/`, which is exactly what a project holds. It differs in having no
// `project.yaml` and in naming its ends `@in`/`@out` — neither of which any graph verb reads.
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectChainNodes, setModuleBypass } from "./projectEdit";

let dir: string;
const graph = () => readFileSync(join(dir, "graph.yaml"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chain-edit-"));
  // A template, as the library holds one: no project.yaml, ends named `@in` and `@out`.
  writeFileSync(
    join(dir, "graph.yaml"),
    'modules:\n  "@in": [ comp ]\n  comp: [ "@out" ]\n',
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", "comp.yaml"),
    'extends: "@st0/audio/comp"\n',
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a chain template is edited by the graph's own verbs", () => {
  it("draws an arrow in it, with no project.yaml anywhere", () => {
    connectChainNodes(dir, "comp", "reverb");
    expect(graph()).toMatch(/comp:\s*\[[^\]]*reverb/);
  });

  it("bypasses a node in it", () => {
    setModuleBypass(dir, "comp", true);
    expect(graph()).toMatch(/bypassed:[\s\S]*comp/);
  });

  it("leaves the template's ENDS alone — they are what makes it a template", () => {
    connectChainNodes(dir, "comp", "reverb");
    const after = graph();
    expect(after).toContain("@in");
    expect(after).toContain("@out");
  });

  it("refuses a folder with no graph file, naming what it wanted", () => {
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    try {
      expect(() => connectChainNodes(bare, "a", "b")).toThrow(/graph\.yaml/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
