import { describe, expect, it } from "vitest";
import { MODULE_OWN_BASES } from "./moduleIO";
import { firstIssue, parserFor, validateFile } from "./validate";

describe("validateFile", () => {
  it("passes a module file the loader would accept", () => {
    const v = validateFile("modules/audio/cab/module.yaml", "extends: amp\n");
    expect(v).toMatchObject({ ok: true, depth: "schema", malformed: false });
  });

  it("refuses an unknown key, and says where it is", () => {
    const v = validateFile(
      "modules/audio/cab/module.yaml",
      "extends: amp\nparamz: 3\n",
    );
    expect(v.ok).toBe(false);
    expect(v.depth).toBe("schema");
    expect(v.malformed).toBe(false);
    expect(v.issues[0].line).toBe(2);
    expect(firstIssue(v)).toContain("l.2");
  });

  it("separates text that does not parse from text that does not validate", () => {
    const v = validateFile("modules/audio/cab/module.yaml", "params: {a: 1\n");
    expect(v).toMatchObject({ ok: false, depth: "syntax", malformed: true });
    expect(v.issues[0].message).toMatch(/flow|expected/i);
  });

  it("judges nothing it has no schema for — and that is not a failure", () => {
    // The médiathèque's song sidecar: real YAML, but not a project file.
    const v = validateFile("songs/pearl/song.yaml", "title: Pearl\nbpm: 92\n");
    expect(v).toMatchObject({ ok: true, depth: "syntax" });
    // A file that isn't YAML at all is not this module's business.
    expect(
      validateFile("modules/audio/cab/jsdsp.ts", "not { yaml"),
    ).toMatchObject({ ok: true, depth: "none" });
  });

  it("still catches broken YAML in a file it has no schema for", () => {
    const v = validateFile("songs/pearl/song.yaml", "title: [Pearl\n");
    expect(v).toMatchObject({ ok: false, malformed: true });
  });

  it("routes each folder to its own schema", () => {
    // A LANE goes to the module parser, because that is what it is (docs/trackModules.md).
    expect(
      validateFile(
        "nodes/lead.yaml",
        'extends: "@studio/track"\ndisabled: soon\n',
      ).ok,
    ).toBe(false);
    expect(
      validateFile(
        "nodes/lead.yaml",
        'extends: "@studio/track"\ndisabled: true\n',
      ).ok,
    ).toBe(true);
    expect(validateFile("graph.yaml", "modules:\n  lead: [cab]\n").ok).toBe(
      true,
    );
    expect(validateFile("project.yaml", "project:\n  tempo: 120\n").ok).toBe(
      true,
    );
  });

  it("reads a module folder's own files as themselves, and everything else as a use", () => {
    // ui.yaml is a panel, not a module: `cols` belongs to it and nowhere else.
    expect(
      validateFile(
        "modules/audio/cab/ui.yaml",
        "cols: 4\nrows: 2\nwidgets: {}\n",
      ).ok,
    ).toBe(true);
    expect(validateFile("modules/audio/cab/module.yaml", "cols: 4\n").ok).toBe(
      false,
    );
    // A node is the module schema again — a use of it says what it overrides.
    expect(
      validateFile("modules/audio/cab/slap.yaml", "params:\n  drive: 3\n").ok,
    ).toBe(true);
    expect(validateFile("nodes/slap.yaml", "params:\n  drive: 3\n").ok).toBe(
      true,
    );
  });

  it("covers exactly the module folder's own basenames", () => {
    // The router cannot import moduleIO (it reads the disk), so the two are pinned here:
    // add a sibling file there without adding it here and it would be read as a node.
    const own = [...MODULE_OWN_BASES].filter((b) => b !== "module");
    const asModule = (base: string) =>
      parserFor(`modules/audio/cab/${base}.yaml`) ===
      parserFor("modules/audio/cab/module.yaml");
    expect(own.filter(asModule)).toEqual([]);
  });
});
