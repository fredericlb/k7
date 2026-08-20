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

// The visual module editor writes into a file a person also edits by hand, so the two
// promises that matter are: every line outside `ui:` comes back byte-identical, and what
// the grid writes is something the loader will accept.
//
// Nothing covered this while it was CUE text surgery. The bug the range test pins is real
// and was found by reading that code: a knob retyped to a toggle kept its `min`, and the
// file then failed to load — taking the module's whole graph node with it.

const MODULE = `# the lead voice
extends: instruments/fourosc
params:
  Filter Freq: 90
  Level: -12
ui:
  cols: 4
  rows: 2
  widgets:
    w1: { type: knob, col: 0, row: 0, bind: Filter Freq, min: 0, max: 1 }
`;

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
    const bare = "plugin:\n  type: internal\n  name: 4osc\n";
    expect(readUi(bare).widgets).toEqual({});
    expect(hasMalformedUi(bare)).toBe(false); // the grid may create one
    expect(hasParsableUi(bare)).toBe(false);
  });

  it("calls a ui the schema refuses MALFORMED, so the pane stays read-only", () => {
    // Silently replacing text it misread is the one thing the editor must not do.
    const bad =
      "ui:\n  cols: 4\n  rows: 2\n  widgets:\n    w1: { type: nope }\n";
    expect(hasParsableUi(bad)).toBe(false);
    expect(hasMalformedUi(bad)).toBe(true);
  });

  it("reads params as text, including one the schema would refuse", () => {
    // The pane only displays them, and a value that won't load should still be visible —
    // showing what is actually in the file is the point.
    expect(readParams(MODULE)).toEqual({ "Filter Freq": "90", Level: "-12" });
    expect(readParams("params:\n  Drive: loud\n")).toEqual({ Drive: "loud" });
  });

  it("reads the extends ref, and nothing when there is none", () => {
    expect(extendsRefOf(MODULE)).toBe("instruments/fourosc");
    expect(extendsRefOf("plugin:\n  name: 4osc\n")).toBe(null);
  });
});

/**
 * The `plugin:` block, which is how a module in a LIBRARY gets a parameter list at all.
 *
 * `_libraries/modules/instruments/4osc/module.yaml` is not a base of the open song, is not
 * instantiated, and the builder overlay holds no engine link — so every other source is empty and
 * the bind dropdown was too. The file states which plugin it is; that is the one thing available.
 */
describe("the plugin a module declares", () => {
  it("reads the two words the built-in table is keyed on", () => {
    expect(readPlugin("plugin:\n  type: internal\n  name: 4osc\n")).toEqual({
      type: "internal",
      name: "4osc",
    });
    expect(readPlugin('plugin:\n  type: vst3\n  name: "Serum"\n')).toEqual({
      type: "vst3",
      name: "Serum",
    });
  });

  it("is null for a module that only EXTENDS one", () => {
    // Deliberately shallow: inheriting the plugin means resolving a ref this component cannot
    // resolve. That module still has the two learned sources and the live engine's report.
    expect(readPlugin(MODULE)).toBe(null);
  });

  it("is null rather than throwing on a half-written or partial block", () => {
    // Completion on a file being typed is exactly when this runs.
    expect(readPlugin("plugin: [unclosed\n")).toBe(null);
    expect(readPlugin("plugin:\n  type: internal\n")).toBe(null); // no name yet
    expect(readPlugin("plugin: 4osc\n")).toBe(null); // a scalar, not the block
    expect(readPlugin("")).toBe(null);
  });
});

describe("writing", () => {
  it("leaves every line outside `ui:` byte-identical", () => {
    const ui = readUi(MODULE);
    ui.widgets.w1.col = 2;
    const after = writeUi(MODULE, ui);
    // The comment, the extends and the params survive exactly.
    expect(
      after.startsWith("# the lead voice\nextends: instruments/fourosc\n"),
    ).toBe(true);
    expect(after).toContain("Filter Freq: 90");
    expect(after).toContain("Level: -12");
    expect(after).toContain("col: 2");
  });

  it("writes one widget per line, as a flow mapping", () => {
    // The shape these files already have by hand, and what keeps moving a knob to a
    // one-line diff instead of a five-line one.
    const ui = readUi(MODULE);
    const line = writeUi(MODULE, ui)
      .split("\n")
      .find((l) => l.includes("w1:"));
    expect(line).toMatch(/^\s*w1: \{ type: knob,.*\}$/);
  });

  it("creates the block when the file has none", () => {
    const bare = "plugin:\n  type: internal\n  name: 4osc\n";
    const after = writeUi(bare, {
      cols: 2,
      rows: 1,
      widgets: { a: { type: "toggle", col: 0, row: 0, bind: "Mute" } },
    });
    expect(after).toContain("plugin:");
    expect(after).toContain("ui:");
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
    // THE bug: a knob has min/max; retype it to a toggle and the range must not travel,
    // or the schema refuses the file and the module stops loading entirely.
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

  it("is stable — writing an unchanged model twice changes nothing the second time", () => {
    const first = writeUi(MODULE, readUi(MODULE));
    const second = writeUi(first, readUi(first));
    expect(second).toBe(first);
  });

  it("keeps a tabs widget readable down the page rather than on one line", () => {
    const after = writeUi("", {
      cols: 4,
      rows: 2,
      widgets: {
        t: {
          type: "tabs",
          col: 0,
          row: 0,
          pages: { osc: { k: { type: "knob", col: 0, row: 0, bind: "Mix" } } },
        },
      },
    });
    expect(after).toContain("pages:");
    expect(hasParsableUi(after)).toBe(true);
  });
});

// An `io: in` module runs no plugin — the input IS the module — so the builder has no scanned parameter list to
// offer and its panel had nothing bindable on it. `ioOf` is what tells the two kinds of module apart.
describe("an io module's direction", () => {
  it("reads the direction an io module declares", () => {
    expect(ioOf("io: in\nchannel: [2]\n")).toBe("in");
    expect(ioOf("io: out\n")).toBe("out");
  });

  it("is null for an ordinary plugin module, which has none", () => {
    // The distinction the builder turns on: offering `@gain` on a reverb would name nothing.
    expect(ioOf(MODULE)).toBe(null);
  });

  it("is null rather than throwing on a file that doesn't parse", () => {
    expect(ioOf("io: [unclosed\n")).toBe(null);
  });

  // THE bug the picker shipped with. A real input in a real song states no `io:` at all — this is
  // `nodes/ge_rythm-in.yaml` from 01.danse.st0, whole — and reading only the file's own key called it
  // an ordinary plugin, so it got neither the io binds nor a channel dropdown.
  it("follows `extends` to the engine's io modules", () => {
    const node = 'extends: "@engine/IN"\nchannel: [ 2 ]\n';
    expect(ioOf(node)).toBe("in");
    expect(ioOf('extends: "@engine/OUT"\n')).toBe("out");
    expect(ioOf('extends: "@engine/FILE"\n')).toBe("file");
  });

  it("does not mistake an ordinary engine plugin for an io module", () => {
    expect(ioOf('extends: "@engine/neural-amp-modeler"\n')).toBe(null);
  });

  it("reads the direction off the PATH for a file that inherits it by location", () => {
    // `in-2.yaml` beside `io/IN/module.yaml` carries a channel and nothing else — the folder is
    // what says it is an input, exactly as the loader reads it.
    expect(ioOf("channel: [1, 2]\n", "_modules/io/IN/in-2.yaml")).toBe("in");
    expect(ioOf("", "C:\\ws\\_modules\\io\\OUT\\main.yaml")).toBe("out");
    expect(ioOf("", "nodes/io/notamodule/x.yaml")).toBe(null);
  });

  it("lets the file's own `io:` win over both", () => {
    expect(ioOf('io: out\nextends: "@engine/IN"\n', "io/IN/x.yaml")).toBe(
      "out",
    );
  });
});

// The channel picker's two halves. Reading has to keep a preferences LABEL a label, because the
// builder does not hold the machine's preferences and cannot resolve one; writing has to leave a
// hand-written file looking hand-written, since these are the files people edit as text first.
describe("an input module's channels", () => {
  it("reads a list of channels as the numbers it names", () => {
    expect(channelOf("io: in\nchannel: [1, 2]\n")).toEqual([1, 2]);
    expect(channelOf("io: in\nchannel: [3]\n")).toEqual([3]);
  });

  it("reads a preferences label as the label, not as numbers", () => {
    // Resolving it belongs to whoever holds the preferences; guessing here would write the
    // rig's naming out of the file the first time somebody touched the dropdown.
    expect(channelOf("io: in\nchannel: Guitare\n")).toBe("Guitare");
  });

  it("is null when the module points at no socket, and on a file that doesn't parse", () => {
    expect(channelOf("io: in\n")).toBe(null);
    expect(channelOf("io: in\nchannel: [unclosed\n")).toBe(null);
  });

  it("writes the channels inline, the way every input in the repo is written", () => {
    expect(setChannelIn("io: in\nchannel: [1]\n", [1, 2])).toContain(
      "channel: [ 1, 2 ]",
    );
  });

  it("adds the key to a module that declared none", () => {
    const after = setChannelIn("io: in\nname: Voix\n", [4]);
    expect(channelOf(after)).toEqual([4]);
    expect(after).toContain("name: Voix");
  });

  it("replaces a preferences label when the user picks a channel by hand", () => {
    expect(
      channelOf(setChannelIn("io: in\nchannel: Guitare\n", [7, 8])),
    ).toEqual([7, 8]);
  });

  it("leaves every other line of a hand-written file alone", () => {
    const before = "# the room mic\nio: in\nchannel: [1]\nname: Salle\n";
    const after = setChannelIn(before, [5, 6]);
    expect(after).toContain("# the room mic");
    expect(after).toContain("name: Salle");
    expect(after.split("\n").length).toBe(before.split("\n").length);
  });
});

// The builder's `status` dropdown, which is these two functions and a <Select>. The field says
// nothing about sound — only how the completions rank the module — so what is worth pinning is
// that the default is never WRITTEN and that a hand-written file survives being set.
describe("a module's status", () => {
  it("reads listed for a file that says nothing", () => {
    expect(statusOf("name: Amp\n")).toBe("listed");
    expect(statusOf("")).toBe("listed");
  });

  it("reads the two that are written", () => {
    expect(statusOf("status: hidden\n")).toBe("hidden");
    expect(statusOf("name: Amp\nstatus: favorite\n")).toBe("favorite");
  });

  it("writes the two that are not the default", () => {
    expect(setStatusIn("name: Amp\n", "hidden")).toContain("status: hidden");
    expect(statusOf(setStatusIn("name: Amp\n", "favorite"))).toBe("favorite");
  });

  // The point of the field being optional: a library where every module carries
  // `status: listed` is a line of noise per file that a reader has to learn to skip.
  it("CLEARS rather than writing the default", () => {
    const after = setStatusIn("name: Amp\nstatus: hidden\n", "listed");
    expect(after).not.toContain("status");
    expect(statusOf(after)).toBe("listed");
  });

  it("is a no-op on a file that already had none", () => {
    expect(setStatusIn("name: Amp\n", "listed")).toBe("name: Amp\n");
  });

  it("leaves every other line of a hand-written file alone", () => {
    const before = "# the lead amp\nname: Amp\nplugin: { name: nam }\n";
    const after = setStatusIn(before, "favorite");
    expect(after).toContain("# the lead amp");
    expect(after).toContain("plugin: { name: nam }");
    expect(statusOf(after)).toBe("favorite");
  });
});
