// A NOTE on the graph: a node of the built-in `@studio/doc`, carrying its own `content`.
// What is pinned here is the shape that makes it a note rather than a device — one input, no
// output, no plugin — and that its text survives the compile. See docs/docModules.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_TYPES } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOC_REF, isDoc } from "./docModule";
import { loadGraph } from "./graph";
import { loadModuleRefs, loadModules } from "./loader";

let dir: string;

/** A project whose chain runs `amp` and then a note wired off it. */
function project(content = "watch the gain here"): string {
  const p = join(dir, "song.st0");
  mkdirSync(join(p, "nodes"), { recursive: true });
  writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(
    join(p, "nodes", "amp.yaml"),
    "plugin: { type: internal, name: Chorus }\n",
  );
  // OUT needs no file at all — a built-in sink name (docs/moduleTypes.md).
  writeFileSync(
    join(p, "nodes", "notes.yaml"),
    `extends: "${DOC_REF}"\ncontent: |\n  ${content.split("\n").join("\n  ")}\n`,
  );
  writeFileSync(
    join(p, "nodes", "gtr.yaml"),
    'extends: "@studio/track"\nevents: []\n',
  );
  writeFileSync(
    join(p, "graph.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT, notes ]\n",
  );
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-doc-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the built-in doc module", () => {
  it("resolves with no file anywhere", () => {
    // A note must cost ONE file, its node, so there is nothing to scaffold and nothing to forget.
    const refs = loadModuleRefs(project());
    expect(refs[DOC_REF]).toBeDefined();
    expect(isDoc(refs[DOC_REF])).toBe(true);
  });

  it("takes ONE input and gives no output", () => {
    // An output would let a run continue THROUGH a comment: documentation feeding audio.
    const meta = MODULE_TYPES.docs;
    expect(meta.inputs).toHaveLength(1);
    expect(meta.outputs).toEqual([]);
    expect(meta.kind).toBe("doc");
  });

  it("is neither an io module nor a plugin", () => {
    // The third `kind` earns itself: folding it into either makes every sink test lie about a note.
    expect(MODULE_TYPES.docs.kind).not.toBe("io");
    expect(MODULE_TYPES.docs.kind).not.toBe("plugin");
  });
});

describe("a note in a project", () => {
  it("is a NODE, and carries its own text", () => {
    const p = project("line one\nline two");
    const notes = loadModules(p).notes;
    expect(notes.node).toBeTruthy();
    expect(String(notes.content)).toContain("line one");
    expect(String(notes.content)).toContain("line two");
  });

  it("inherits the doc SHAPE from what it extends", () => {
    // The node declares ONLY `content`, so unresolved it says nothing about `kind` or its ports…
    const raw = loadModules(project()).notes;
    expect(raw.kind).toBeUndefined();
    // …and resolved — which is what every consumer sees — it is a doc with no output.
    const m = loadGraph(project()).modules.notes;
    expect(isDoc(m)).toBe(true);
    expect(m.outputs).toEqual([]);
  });

  it("reaches the graph with its text, and compiles no plugin", () => {
    const g = loadGraph(project("mind the gain"));
    const m = g.modules.notes;
    expect(m.kind).toBe("doc");
    expect(String(m.content)).toContain("mind the gain");
    // Nothing for the engine to load: a note is drawn, never played.
    expect(m.plugin).toBeUndefined();
  });

  it("does not make the project complain", () => {
    // A note is an ordinary destination, not a dangling reference or an unknown module.
    expect(loadGraph(project()).warnings).toEqual([]);
  });
});
