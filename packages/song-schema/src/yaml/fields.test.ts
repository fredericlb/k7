import { describe, expect, it } from "vitest";
import { fieldsAt, fileKindFor, valuesAt } from "./fields";
import { ModuleSchema } from "./moduleSchema";

// These tests pin the completions the editor derives from the Zod schemas — see docs/fields.md.

describe("derived module fields", () => {
  it("matches the hand-kept table, plus the field the table was missing", () => {
    // Every module field, in the order the completions offer them (docs/fields.md).
    expect(fieldsAt("module", [])).toEqual([
      "extends",
      "plugin",
      "io",
      // A module's OWN ports, overriding its type folder's defaults — see docs/ports.md.
      "inputs",
      "outputs",
      "type",
      // Which GLSL program a shader node runs, out of its own `shaders/` — a FIELD, not a param.
      "shader",
      "params",
      "rack",
      // A COLD module works only on audio already on disk — see docs/coldModules.md.
      "cold",
      // `ir`, `nam` and `jsdsp` carry no field of their own, so there is nothing to complete against (docs/fields.md).
      "channel",
      // …and WHICH lens an io "camera" opens, plus where in the viewport it draws — docs/camera.md.
      "camera",
      "frame",
      // No `track`: where an input LANDS is the chain's business (docs/fields.md).
      "source", // …and the OTHER kind of source: an io "file" reads audio off disk
      "monitor",
      "gain", // the other thing an input does to its signal, beside whether you hear it
      // The named .vstpreset a module starts from, out of its own `base/` — see docs/userPresets.md.
      "base",
      "ui",
      "automations",
      // No `docs` or `todos`: no panel reads them — see docs/docModules.md.
      "content",
      // …and a LANE's own fields, a lane being a module rather than a second entity (docs/trackModules.md).
      "events",
      // …and the arrangements a take holds, beside `events:` because it is the same thing set aside.
      "takes",
      "color",
      "disabled",
      "tracks",
      "strudel",
      // FROZEN at this module: the render standing in for everything upstream of it — see docs/freeze.md.
      "frozen",
      // …and the module's other attribute SETS, last because they are ABOUT the fields above (docs/fields.md).
      "alternatives",
      "alternative",
      // …and how the COMPLETIONS should treat this module, outside MODULE_FIELDS so an alternative cannot restate it.
      "status",
    ]);
    // …and it cannot fall behind: the source is the schema.
    expect(fieldsAt("module", [])).toEqual(Object.keys(ModuleSchema.shape));
  });

  it("answers inside a take, at both of its levels", () => {
    // A take is a list of lists, and the editor completes both levels — see docs/fields.md.
    expect(fieldsAt("module", ["takes", "0"])).toEqual(["name", "events"]);
    expect(fieldsAt("module", ["takes", "0", "events", "0"])).toEqual(
      fieldsAt("module", ["events"]),
    );
  });

  it("answers for a nested struct, which the CUE version could not", () => {
    // A nested struct answers from its own shape, however deep it sits (docs/fields.md).
    expect(fieldsAt("module", ["ui"])).toEqual(["cols", "rows", "widgets"]);
    expect(fieldsAt("module", ["ui", "widgets", "w1"])).toContain("library");
    expect(fieldsAt("module", ["ui", "widgets", "w1"])).toContain("bind");
    expect(fieldsAt("module", ["rack"])).toEqual(
      expect.arrayContaining(["rack_type", "source", "symbols"]),
    );
    expect(fieldsAt("module", ["rack", "symbols", "BD"])).toEqual([
      "note",
      "clip",
      "from",
      "to",
    ]);
  });

  it("offers nothing inside an open map", () => {
    // `params` is a free map and `plugin` is deliberately open; offering names there would invent a vocabulary.
    expect(fieldsAt("module", ["params"])).toEqual([]);
    expect(fieldsAt("module", ["plugin"])).toEqual([]);
  });
});

describe("derived lane fields", () => {
  it("has no kind of its own — a lane is a module file", () => {
    // No `track` FileKind and no per-kind narrowing: a lane file answers as a module — see docs/fields.md.
    expect(fileKindFor("nodes/melody.yaml")).toBe("module");
    expect(fileKindFor("tracks/melody.yaml")).toBeNull();
    expect(fieldsAt("module", [])).toEqual(
      expect.arrayContaining(["events", "tracks", "strudel", "color"]),
    );
  });

  it("answers inside an ALTERNATIVE with the module's own fields", () => {
    // A set is a module partial, plus a name and minus `extends` — derived, so the two cannot drift.
    const inside = fieldsAt("module", ["alternatives", "0"]);
    expect(inside).toContain("name");
    expect(inside).toContain("params");
    expect(inside).toContain("events");
    expect(inside).not.toContain("extends");
    expect(inside).not.toContain("alternatives");
    // The list itself has no field vocabulary — its entries are positions, not names.
    expect(fieldsAt("module", ["alternatives"])).toEqual([]);
  });

  it("answers inside a placement", () => {
    expect(fieldsAt("module", ["events"])).toEqual([
      "ref",
      "start",
      // The event's own window — the placement-level half of the material's pair.
      "from",
      "to",
      "fadeIn",
      "fadeOut",
      "loop",
      "disabled",
      // Whether this event plays the material's stretch map — `event status warp` writes it.
      "warp",
    ]);
  });
});

describe("derived values", () => {
  it("offers a closed set where the schema has one", () => {
    expect(valuesAt("module", [], "type")).toEqual([
      "plugin",
      "rack",
      "video_effect",
      "video_transition",
    ]);
    expect(valuesAt("module", [], "monitor")).toEqual(["off", "auto", "on"]);
    // Both DERIVED from the schema's own constants — this table had already fallen two values
    // behind `io:` before they were, which is the drift the two `as const`s now prevent.
    expect(valuesAt("module", [], "io")).toEqual([
      "out",
      "in",
      "video_out",
      "file",
      "camera",
    ]);
    // …and the recorder node's own picture, beside the two live taps — docs/recorder.md.
    expect(valuesAt("module", ["ui", "widgets", "w1"], "source")).toEqual([
      "input",
      "output",
      "take",
    ]);
    expect(valuesAt("module", ["ui", "widgets", "w1"], "type")).toContain(
      "dropdown",
    );
  });

  it("offers nothing where the value is free text", () => {
    // A param name, a module name, a docs string — a list there would read as the only allowed values.
    expect(valuesAt("module", [], "extends")).toEqual([]);
    expect(valuesAt("module", [], "docs")).toEqual([]);
  });
});

describe("chain fields", () => {
  it("offers the file's four sections, and nothing inside them", () => {
    // `bus_only:` is NOT a synonym of `bypassed:` — see packages/song/docs/busOnly.md.
    expect(fieldsAt("chains", [])).toEqual([
      "modules",
      "bypassed",
      "bus_only",
      "positions",
    ]);
    // Inside a section the keys are node NAMES, a project's own vocabulary the schema cannot know.
    expect(fieldsAt("chains", ["modules"])).toEqual([]);
  });
});
