import { describe, expect, it } from "vitest";
import { fieldsAt, trackFieldsForType, valuesAt } from "./fields";
import { ModuleSchema } from "./moduleSchema";

// The other half of the editor spike: the vocabulary the completions offer, DERIVED from
// the schemas instead of tabulated by hand.
//
// The tables it replaces are 162 lines in ui-editor's CUE completions, and they had
// drifted — `library_from` was absent for as long as the field existed, then added to the
// tier where it does nothing. These tests pin the derivation against the tables that were
// there, and pin the one case where the table was WRONG rather than merely behind.

describe("derived module fields", () => {
  it("matches the hand-kept table, plus the field the table was missing", () => {
    // MODULE_FIELDS as it stands in completions.ts today, in order — and `automations`,
    // which the table lacks because the SHIPPED CUE schema lacks it too. The GENERATED
    // one (#tdModule, the enforced copy) has always had it, and real modules use it: the
    // two CUE schemas had drifted apart, and the completion list followed the wrong one.
    // Deriving from a single schema is what makes that impossible rather than unlikely.
    expect(fieldsAt("module", [])).toEqual([
      "extends",
      "plugin",
      "io",
      // A module's OWN ports, overriding its type folder's defaults — what makes "two audio
      // inputs" sayable at all. See docs/ports.md.
      "inputs",
      "outputs",
      "type",
      "params",
      "rack",
      // A COLD module works only on audio already on disk — it needs the whole of its input
      // before it can produce any of it. See docs/coldModules.md.
      "cold",
      // `ir` and `nam` sat here, each naming a file in a shared asset library. The library is
      // gone — a module carries what it loads, in its own `assets/` — and the one that survived
      // is a `params:` entry, because a .nam model is one of the plugin's controls. So there is
      // no top-level field left to complete against; see moduleTypes.FILE_PARAMS.
      // `jsdsp` was here: a filename beside a `plugin: {type: internal, name: DSP Graph}` that
      // said nothing about it. The TYPE says it now — `plugin: {type: jsdsp}` — and the file is
      // `jsdsp.ts` in the module's folder, so there is no field left to complete against.
      "channel",
      // `track` sat here until an input's landing place became the chain's business —
      // a shared io/IN module has one instance per physical input and no project to
      // name a track in. See moduleSchema's note on `channel`.
      "source", // …and the OTHER kind of source: an io "file" reads audio off disk
      "monitor",
      "gain", // the other thing an input does to its signal, beside whether you hear it
      "ui",
      "automations",
      // `docs` and `todos` sat here. They are gone with the Docs panel that was their only
      // reader: a note is a doc module on the graph now, and `content` is its text — the whole
      // of what a doc module carries. See docs/docModules.md.
      "content",
    ]);
    // …and it cannot fall behind: the source is the schema.
    expect(fieldsAt("module", [])).toEqual(Object.keys(ModuleSchema.shape));
  });

  it("answers for a nested struct, which the CUE version could not", () => {
    // structFields() returned [] for anything it had no branch for — so `ui:` offered its
    // fields but `project: {}` offered nothing at all, which is the bug from this morning.
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
    // `params` is param-name -> number and `plugin` is deliberately open (the engine owns
    // its shape). Offering field names there would invent a vocabulary.
    expect(fieldsAt("module", ["params"])).toEqual([]);
    expect(fieldsAt("module", ["plugin"])).toEqual([]);
  });
});

describe("derived track fields", () => {
  it("fixes what the flat table got WRONG, not just what it lacked", () => {
    // The CUE table listed all three kinds of track at once, so it offered `tracks` (a
    // group's members) and `strudel` on an audio track — where the schema refuses both.
    // At the top level, before `type:` is written, every kind is still possible…
    const top = fieldsAt("track", []);
    expect(top).toEqual(
      expect.arrayContaining(["type", "clips", "tracks", "strudel"]),
    );
    // …but once the kind is known, only its own fields apply. A flat table cannot do this.
    expect(trackFieldsForType("single")).toContain("clips");
    expect(trackFieldsForType("single")).not.toContain("tracks");
    expect(trackFieldsForType("group")).toContain("tracks");
    expect(trackFieldsForType("group")).not.toContain("clips");
    expect(trackFieldsForType("strudel")).toContain("strudel");
    expect(trackFieldsForType("strudel")).not.toContain("clips");
  });

  it("answers inside a placement", () => {
    expect(fieldsAt("track", ["clips"])).toEqual([
      "ref",
      "start",
      "fadeIn",
      "fadeOut",
      "loop",
      "disabled",
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
    expect(valuesAt("module", ["ui", "widgets", "w1"], "type")).toContain(
      "dropdown",
    );
    expect(valuesAt("track", [], "type")).toEqual([
      "single",
      "group",
      "strudel",
    ]);
  });

  it("offers nothing where the value is free text", () => {
    // A param name, a module name, a docs string. Offering a list there would read as
    // though those were the only allowed values.
    expect(valuesAt("module", [], "extends")).toEqual([]);
    expect(valuesAt("module", [], "docs")).toEqual([]);
  });
});

describe("chain fields", () => {
  it("offers the file's three sections, and nothing inside them", () => {
    expect(fieldsAt("chains", [])).toEqual(["tracks", "modules", "bypassed"]);
    // Inside a section the keys are node NAMES — a project's own vocabulary, which the
    // schema cannot know. Offering field names there would invent one.
    expect(fieldsAt("chains", ["tracks"])).toEqual([]);
    expect(fieldsAt("chains", ["modules"])).toEqual([]);
  });
});
