import {
  firstIssue,
  parserFor,
  validateFile,
} from "@studio/song-schema/yaml/validate";
import { describe, expect, it } from "vitest";
import { MODULE_OWN_BASES } from "./moduleIO";

describe("validateFile", () => {
  it("passes a module file the loader would accept", () => {
    const v = validateFile("modules/audio/cab/module.k7x", 'extends("amp")\n');
    expect(v).toMatchObject({ ok: true, depth: "schema", malformed: false });
  });

  it("refuses an unknown key, and says where it is", () => {
    const v = validateFile(
      "modules/audio/cab/module.k7x",
      'extends("amp")\nparamz(3)\n',
    );
    expect(v.ok).toBe(false);
    expect(v.depth).toBe("schema");
    expect(v.malformed).toBe(false);
    expect(v.issues[0].line).toBe(2);
    expect(firstIssue(v)).toContain("l.2");
  });

  it("separates text that does not parse from text that does not validate", () => {
    const v = validateFile("modules/audio/cab/module.k7x", "params({a: 1\n");
    expect(v).toMatchObject({ ok: false, depth: "syntax", malformed: true });
    expect(v.issues[0].line).toBeGreaterThan(0);
  });

  it("judges nothing it has no schema for — and that is not a failure", () => {
    const v = validateFile("notes/pearl.k7x", 'title("Pearl").bpm(92)\n');
    expect(v).toMatchObject({ ok: true, depth: "syntax" });
    // A file that isn't k7x at all is not this module's business, YAML included.
    expect(
      validateFile("modules/audio/cab/jsdsp.ts", "not { k7x"),
    ).toMatchObject({ ok: true, depth: "none" });
    expect(
      validateFile("modules/audio/cab/module.yaml", "paramz: 3\n"),
    ).toMatchObject({ ok: true, depth: "none" });
  });

  it("still catches broken k7x in a file it has no schema for", () => {
    const v = validateFile("notes/pearl.k7x", 'title(["Pearl"\n');
    expect(v).toMatchObject({ ok: false, malformed: true });
  });

  it("routes each folder to its own schema", () => {
    // A LANE goes to the module parser, because that is what it is (docs/trackModules.md).
    expect(
      validateFile(
        "nodes/lead.k7x",
        'extends("@meta/track")\ndisabled("soon")\n',
      ).ok,
    ).toBe(false);
    expect(
      validateFile("nodes/lead.k7x", 'extends("@meta/track")\ndisabled(true)\n')
        .ok,
    ).toBe(true);
    expect(validateFile("graph.k7x", 'modules({ lead: ["cab"] })\n').ok).toBe(
      true,
    );
    expect(validateFile("project.k7x", "project({ tempo: 120 })\n").ok).toBe(
      true,
    );
  });

  it("reads a module folder's own files as themselves, and everything else as a use", () => {
    // ui.k7x is a panel, not a module: `cols` belongs to it and nowhere else.
    expect(
      validateFile(
        "modules/audio/cab/ui.k7x",
        "cols(4)\nrows(2)\nwidgets({})\n",
      ).ok,
    ).toBe(true);
    expect(validateFile("modules/audio/cab/module.k7x", "cols(4)\n").ok).toBe(
      false,
    );
    // A node is the module schema again — a use of it says what it overrides.
    expect(
      validateFile("modules/audio/cab/slap.k7x", "params({ drive: 3 })\n").ok,
    ).toBe(true);
    expect(validateFile("nodes/slap.k7x", "params({ drive: 3 })\n").ok).toBe(
      true,
    );
  });

  it("reads a preset tree's files as presets, in the workspace and in a library", () => {
    const preset = 'engine("tracktion")\nparams({ Ratio: 4 })\n';
    for (const at of [
      "_presets/k7-core/audio/compressor/soft.k7x",
      "_libraries/k7-core/presets/k7-core/audio/compressor/soft.k7x",
      "/home/u/.k7/libraries/k7-core/presets/workspace/modules/x/soft.k7x",
    ]) {
      expect(validateFile(at, preset).ok).toBe(true);
      expect(validateFile(at, 'params({ Ratio: "loud" })\n').ok).toBe(false);
    }
    // A preset is not a module: `extends` is refused there.
    expect(
      validateFile(
        "_presets/k7-core/audio/compressor/soft.k7x",
        'extends("x")\n',
      ).ok,
    ).toBe(false);
  });

  it("covers exactly the module folder's own basenames", () => {
    // The router cannot import moduleIO, so an unlisted sibling file would be read as a node.
    const own = [...MODULE_OWN_BASES].filter((b) => b !== "module");
    const asModule = (base: string) =>
      parserFor(`modules/audio/cab/${base}.k7x`) ===
      parserFor("modules/audio/cab/module.k7x");
    expect(own.filter(asModule)).toEqual([]);
  });
});
