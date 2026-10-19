import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  channelOf,
  extendsRefOf,
  hasMalformedUi,
  hasParsableUi,
  ioOf,
  readParams,
  readPlugin,
  readUi,
  setChannelIn,
  setStatusIn,
  statusOf,
  writeUi,
} from "./moduleUi";

// Two promises: every line outside `ui(…)` comes back byte-identical, and what the grid writes loads.

const MODULE = `// the lead voice
extends("instruments/fourosc")
params({
  "Filter Freq": 90,
  Level: -12.0,
})
ui({
  cols: 4,
  rows: 2,
  widgets: {
    // the one knob
    w1: { type: "knob", col: 0, row: 0, bind: "Filter Freq", min: 0, max: 1 },
  },
})
`;

const BARE = 'plugin({ type: "internal", name: "4osc" })\n';

describe("reading", () => {
  it("reads the grid and its widgets", () => {
    const ui = readUi(MODULE);
    expect(ui.cols).toBe(4);
    expect(ui.rows).toBe(2);
    expect(ui.widgets.w1).toMatchObject({
      type: "knob",
      col: 0,
      row: 0,
      bind: "Filter Freq",
      min: 0,
      max: 1,
    });
  });

  it("gives an empty grid for a file with no ui, and doesn't call it malformed", () => {
    expect(readUi(BARE).widgets).toEqual({});
    expect(hasMalformedUi(BARE)).toBe(false); // the grid may create one
    expect(hasParsableUi(BARE)).toBe(false);
  });

  it("calls a ui the schema refuses MALFORMED, so the pane stays read-only", () => {
    // Silently replacing text it misread is the one thing the editor must not do.
    const bad = 'ui({ cols: 4, rows: 2, widgets: { w1: { type: "nope" } } })\n';
    expect(hasParsableUi(bad)).toBe(false);
    expect(hasMalformedUi(bad)).toBe(true);
  });

  it("reads params as text, as written, including one the schema would refuse", () => {
    // The pane only displays them, so a value that will not load should still be visible.
    expect(readParams(MODULE)).toEqual({
      "Filter Freq": "90",
      Level: "-12.0",
    });
    expect(readParams('params({ Drive: "loud" })\n')).toEqual({
      Drive: "loud",
    });
  });

  it("reads the extends ref, and nothing when there is none", () => {
    expect(extendsRefOf(MODULE)).toBe("instruments/fourosc");
    expect(extendsRefOf('plugin({ name: "4osc" })\n')).toBe(null);
  });
});

/** The `plugin(…)` block, which is how a module in a LIBRARY gets a parameter list at all — docs/builder.md. */
describe("the plugin a module declares", () => {
  it("reads the two words the built-in table is keyed on", () => {
    expect(readPlugin(BARE)).toEqual({ type: "internal", name: "4osc" });
    expect(readPlugin('plugin(type("vst3").name("Serum"))\n')).toEqual({
      type: "vst3",
      name: "Serum",
    });
  });

  it("is null for a module that only EXTENDS one", () => {
    // Deliberately shallow: inheriting would mean resolving a ref this component cannot resolve.
    expect(readPlugin(MODULE)).toBe(null);
  });

  it("is null rather than throwing on a half-written or partial block", () => {
    // Completion on a file being typed is exactly when this runs.
    expect(readPlugin("plugin([unclosed\n")).toBe(null);
    expect(readPlugin('plugin({ type: "internal" })\n')).toBe(null); // no name yet
    expect(readPlugin('plugin("4osc")\n')).toBe(null); // a scalar, not the block
    expect(readPlugin("")).toBe(null);
  });
});

describe("writing", () => {
  it("moves a knob as a one-line diff, every other line byte-identical", () => {
    const ui = readUi(MODULE);
    ui.widgets.w1.col = 2;
    const before = MODULE.split("\n");
    const after = writeUi(MODULE, ui).split("\n");
    expect(after).toHaveLength(before.length);
    const changed = after.filter((l, i) => l !== before[i]);
    expect(changed).toEqual([
      '    w1: { type: "knob", col: 2, row: 0, bind: "Filter Freq", min: 0, max: 1 },',
    ]);
  });

  it("keeps a comment inside the block", () => {
    const ui = readUi(MODULE);
    ui.widgets.w2 = { type: "toggle", col: 2, row: 0, bind: "Level" };
    const after = writeUi(MODULE, ui);
    expect(after).toContain("    // the one knob\n");
    expect(after).toContain(
      '    w2: { type: "toggle", col: 2, row: 0, bind: "Level" },\n',
    );
  });

  it("creates the block when the file has none", () => {
    const after = writeUi(BARE, {
      cols: 2,
      rows: 1,
      widgets: { a: { type: "toggle", col: 0, row: 0, bind: "Mute" } },
    });
    expect(after.startsWith(BARE)).toBe(true);
    expect(after).toContain(
      'a: { type: "toggle", col: 0, row: 0, bind: "Mute" }',
    );
    expect(readUi(after).widgets.a).toMatchObject({
      type: "toggle",
      bind: "Mute",
    });
  });

  it("drops the defaults, so the block stays as terse as a hand-written one", () => {
    const after = writeUi("", {
      cols: 2,
      rows: 1,
      widgets: {
        a: { type: "knob", col: 0, row: 0, colSpan: 1, rowSpan: 1, label: "" },
      },
    });
    expect(after).not.toContain("colSpan");
    expect(after).not.toContain("rowSpan");
    expect(after).not.toContain("label");
  });

  it("drops a range when the widget is retyped to a kind that can't carry one", () => {
    // THE bug: retype a knob to a toggle and the range must not travel, or the file stops loading.
    const after = writeUi("", {
      cols: 2,
      rows: 1,
      widgets: {
        a: { type: "toggle", col: 0, row: 0, bind: "Mute", min: 0, max: 1 },
      },
    });
    expect(after).not.toContain("min");
    expect(after).not.toContain("max");
    expect(hasParsableUi(after)).toBe(true); // …and the result loads
  });

  it("round-trips: read, write, read gives the same model", () => {
    const once = readUi(MODULE);
    const twice = readUi(writeUi(MODULE, once));
    expect(twice).toEqual(once);
  });

  it("is stable — writing an unchanged model changes nothing", () => {
    expect(writeUi(MODULE, readUi(MODULE))).toBe(MODULE);
  });

  it("writes the panel's tabs in order, each widget still on one line", () => {
    const after = writeUi("", {
      cols: 4,
      rows: 2,
      widgets: {},
      tabs: [
        {
          name: "Osc",
          widgets: { k: { type: "knob", col: 0, row: 0, bind: "Mix" } },
        },
        { name: "Filter", widgets: {} },
      ],
    });
    expect(after).toMatch(/name\("Osc"\)[\s\S]*name\("Filter"\)/);
    expect(after).toContain('k: { type: "knob", col: 0, row: 0, bind: "Mix" }');
    expect(readUi(after).tabs?.map((t) => t.name)).toEqual(["Osc", "Filter"]);
  });

  it("writes no `tabs` for a panel without them", () => {
    expect(writeUi("", { cols: 2, rows: 1, widgets: {} })).not.toContain(
      "tabs",
    );
  });

  it("hands a buffer that does not parse back unchanged", () => {
    expect(writeUi("ui({", readUi(MODULE))).toBe("ui({");
  });
});

// An `io("in")` module runs no plugin, so `ioOf` is what tells the two kinds apart — see docs/builder.md.
describe("an io module's direction", () => {
  it("reads the direction an io module declares", () => {
    expect(ioOf('io("in")\nchannel([2])\n')).toBe("in");
    expect(ioOf('io("out")\n')).toBe("out");
  });

  it("is null for an ordinary plugin module, which has none", () => {
    // The distinction the builder turns on: offering `@gain` on a reverb would name nothing.
    expect(ioOf(MODULE)).toBe(null);
  });

  it("is null rather than throwing on a file that doesn't parse", () => {
    expect(ioOf("io([unclosed\n")).toBe(null);
  });

  // THE bug the picker shipped with: a node stating no `io` read as a plugin.
  it("follows `extends` to the built-in io roles", () => {
    expect(ioOf('extends("@meta/IN")\nchannel([2])\n')).toBe("in");
    expect(ioOf('extends("@meta/OUT")\n')).toBe("out");
    expect(ioOf('extends("@meta/FILE")\n')).toBe("file");
  });

  it("does not mistake an ordinary engine plugin for an io module", () => {
    expect(ioOf('extends("@engine/neural-amp-modeler")\n')).toBe(null);
  });

  it("reads the direction off the PATH for a file that inherits it by location", () => {
    // `in-2.k7x` carries a channel and nothing else: the FOLDER says it is an input, as the loader reads it.
    expect(ioOf("channel([1, 2])\n", "_modules/io/IN/in-2.k7x")).toBe("in");
    expect(ioOf("", "C:\\ws\\_modules\\io\\OUT\\main.k7x")).toBe("out");
    expect(ioOf("", "nodes/io/notamodule/x.k7x")).toBe(null);
  });

  it("lets the file's own `io` win over both", () => {
    expect(ioOf('io("out")\nextends("@meta/IN")\n', "io/IN/x.k7x")).toBe("out");
  });
});

// The picker's two halves: reading keeps a LABEL a label, and writing leaves a hand-written file so.
describe("an input module's channels", () => {
  it("reads a list of channels as the numbers it names", () => {
    expect(channelOf('io("in")\nchannel([1, 2])\n')).toEqual([1, 2]);
    expect(channelOf('io("in")\nchannel([3])\n')).toEqual([3]);
  });

  it("reads a preferences label as the label, not as numbers", () => {
    // Resolving belongs to whoever holds the preferences: guessing writes the rig's naming out.
    expect(channelOf('io("in")\nchannel("Guitare")\n')).toBe("Guitare");
  });

  it("is null when the module points at no socket, and on a file that doesn't parse", () => {
    expect(channelOf('io("in")\n')).toBe(null);
    expect(channelOf('io("in")\nchannel([unclosed\n')).toBe(null);
  });

  it("writes the channels on one line, the way every input in the repo is written", () => {
    expect(setChannelIn('io("in")\nchannel([1])\n', [1, 2])).toBe(
      'io("in")\nchannel([1, 2])\n',
    );
  });

  it("adds the key to a module that declared none", () => {
    const after = setChannelIn('io("in")\nname("Voix")\n', [4]);
    expect(channelOf(after)).toEqual([4]);
    expect(after).toContain('name("Voix")');
  });

  it("replaces a preferences label when the user picks a channel by hand", () => {
    expect(
      channelOf(setChannelIn('io("in")\nchannel("Guitare")\n', [7, 8])),
    ).toEqual([7, 8]);
  });

  it("leaves every other line of a hand-written file alone", () => {
    const before = '// the room mic\nio("in")\nchannel([1])\nname("Salle")\n';
    const after = setChannelIn(before, [5, 6]);
    expect(after).toBe(before.replace("[1]", "[5, 6]"));
  });
});

// The `status` dropdown: what is worth pinning is that the DEFAULT is never written.
describe("a module's status", () => {
  it("reads listed for a file that says nothing", () => {
    expect(statusOf('name("Amp")\n')).toBe("listed");
    expect(statusOf("")).toBe("listed");
  });

  it("reads the two that are written", () => {
    expect(statusOf('status("hidden")\n')).toBe("hidden");
    expect(statusOf('name("Amp")\nstatus("favorite")\n')).toBe("favorite");
  });

  it("writes the two that are not the default", () => {
    expect(parse(setStatusIn('name("Amp")\n', "hidden")).status).toBe("hidden");
    expect(statusOf(setStatusIn('name("Amp")\n', "favorite"))).toBe("favorite");
  });

  // Why the field is optional: `status("listed")` on every module is a line of noise per file.
  it("CLEARS rather than writing the default", () => {
    const after = setStatusIn('name("Amp")\nstatus("hidden")\n', "listed");
    expect(after).not.toContain("status");
    expect(statusOf(after)).toBe("listed");
  });

  it("is a no-op on a file that already had none", () => {
    expect(setStatusIn('name("Amp")\n', "listed")).toBe('name("Amp")\n');
  });

  it("leaves every other line of a hand-written file alone", () => {
    const before = '// the lead amp\nname("Amp")\nplugin({ name: "nam" })\n';
    const after = setStatusIn(before, "favorite");
    expect(after.startsWith(before)).toBe(true);
    expect(statusOf(after)).toBe("favorite");
  });
});
