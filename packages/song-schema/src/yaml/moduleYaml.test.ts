import { K7Document } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  parseModule,
  setModuleAutomation,
  setModuleList,
  setModuleValue,
} from "./moduleFile";
import { UISchema } from "./moduleSchema";

// Three questions: does it validate TIGHTLY, does this app's vocabulary survive it, and does an EDIT keep the file.

const M = (body: string) => body.replace(/^\n/, "");

/** A writer run over a file's text, the text it leaves. */
const edit = (text: string, write: (doc: K7Document) => void): string => {
  const doc = new K7Document(text);
  write(doc);
  return doc.toString();
};

describe("validation", () => {
  it("accepts a module the app actually writes", () => {
    const { value, issues } = parseModule(
      M(`
plugin({ type: "internal", name: "Chorus" })
ui({
  cols: 4,
  rows: 2,
  widgets: { w1: { type: "knob", col: 0, row: 0, label: "Depth", bind: "Depth", min: 0, max: 1 } },
})
`),
    );
    expect(issues).toEqual([]);
    expect(value?.ui?.widgets.w1.bind).toBe("Depth");
    // The schema's default `type: plugin`, applied on the way out — not into the file.
    expect(value?.type).toBe("plugin");
  });

  it("reads an empty file as an empty module", () => {
    const { value, issues } = parseModule("");
    expect(issues).toEqual([]);
    expect(value?.type).toBe("plugin");
  });

  it("leaves the type unstated when the file extends — the parent's is the answer", () => {
    const { value, issues } = parseModule(
      'extends("@workspace/instruments/kit")\n',
    );
    expect(issues).toEqual([]);
    // A node over a rack states nothing; a default here would beat the rack it inherits.
    expect(value?.type).toBeUndefined();
  });

  it("refuses a `label` — a module is shown by its file name, and there is no second one", () => {
    const { value, issues } = parseModule(
      'label("Grande salle")\nplugin({ type: "internal", name: "Reverb" })\n',
    );
    expect(value).toBeNull();
    expect(issues[0].message).toMatch(/label/);
  });

  it("catches the typo a closed struct is for, and says where", () => {
    // A closed struct is what makes the typo an error at all — an open one drops `paramz` silently.
    const { value, issues } = parseModule(
      'plugin({ type: "internal" })\nparamz({})\n',
    );
    expect(value).toBeNull();
    expect(issues[0].message).toMatch(/paramz/);
    expect(issues[0]).toMatchObject({ line: 2, col: 1 });
  });

  it("reports a syntax error at its line and column", () => {
    const { value, issues } = parseModule(
      'plugin({ type: "internal" })\nui(\n',
    );
    expect(value).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("");
    expect(issues[0].line).toBeGreaterThanOrEqual(2);
  });

  it("reports a widget field that belongs to another type, on its line", () => {
    // The common typo, three times over: `library` on a non-dropdown, `min` on a toggle.
    const { issues } = parseModule(
      M(`
ui({
  cols: 1,
  rows: 1,
  widgets: {
    w2: { type: "toggle", col: 0, row: 0, bind: "Bypass", min: 0 },
  },
})
`),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("ui.widgets.w2.min");
    expect(issues[0].message).toMatch(/carry a range/);
    expect(issues[0].line).toBe(5);
  });

  it("accepts the asset dropdown that started all this", () => {
    const { issues } = parseModule(
      M(`
params({ model: "jcm800.nam" })
ui({
  cols: 4,
  rows: 2,
  widgets: { w2: { type: "dropdown", col: 0, row: 0, bind: "model", library: "model" } },
})
`),
    );
    expect(issues).toEqual([]);
  });

  it("tells a slice rack from a samples one", () => {
    const slice = parseModule(
      M(`
type("rack")
rack({ rack_type: "slice", source: "break.wav", symbols: { BD: { note: 36, from: 0, to: 0.5 } } })
`),
    );
    expect(slice.issues).toEqual([]);
    // A slice rack with no source: the flavour's own branch is what catches it.
    const bad = parseModule(
      M(`
type("rack")
rack({ rack_type: "slice", symbols: { BD: { note: 36, from: 0, to: 0.5 } } })
`),
    );
    expect(bad.value).toBeNull();
  });

  it.each(["rack(null)\n", "rack({})\n", "rack({ symbols: null })\n"])(
    "reads an empty rack as a kit with no pads of its own: %j",
    (rack) => {
      const { value, issues } = parseModule(`type("rack")\n${rack}`);
      expect(issues).toEqual([]);
      expect(value?.rack).toEqual({ rack_type: "samples", symbols: {} });
    },
  );
});

describe("this app's vocabulary", () => {
  it("keeps a note name and a param name with spaces", () => {
    const { value, issues } = parseModule(
      M(`
params({ "Filter Freq": 69, "Transpose - Bypass": 1 })
content("C4")
`),
    );
    expect(issues).toEqual([]);
    expect(value?.params?.["Filter Freq"]).toBe(69);
    expect(value?.params?.["Transpose - Bypass"]).toBe(1);
    expect(value?.content).toBe("C4");
  });
});

describe("editing", () => {
  // A module file as a human leaves it — every part of which a naive parse-then-stringify loses.
  const AUTHORED = M(`
// amp: the head the whole record goes through.
// Swap the model, not the module.
extends("@engine/audio/amp/neural-amp-modeler")

params({
  // the amp — see assets/
  model: "jcm800.nam",
  Mix: 1,
  Level: 0.8,
})

ui({
  cols: 4,
  rows: 2,
  widgets: {
    w1: { type: "knob", col: 0, row: 0, label: "Mix", bind: "Mix", min: 0, max: 1 },
  },
})
`);

  it("changes one value and touches nothing else", () => {
    const after = edit(AUTHORED, (d) =>
      setModuleValue(d.at([]), ["params", "Level"], 0.5),
    );
    const before = AUTHORED.split("\n");
    const changed = after
      .split("\n")
      .map((l, i) =>
        l === before[i] ? null : `${i + 1}: ${before[i]} -> ${l}`,
      )
      .filter(Boolean);
    // ONE line: a knob drag is a one-line diff in git.
    expect(changed).toEqual(["9:   Level: 0.8, ->   Level: 0.5,"]);
  });

  it("keeps every comment", () => {
    // A file-valued param is edited exactly like a numeric one, which is why it lives in `params`.
    const after = edit(AUTHORED, (d) =>
      setModuleValue(d.at([]), ["params", "model"], "twin.nam"),
    );
    expect(after).toContain("// amp: the head the whole record goes through.");
    expect(after).toContain("// Swap the model, not the module.");
    expect(after).toContain("// the amp — see assets/");
    expect(after).toContain('model: "twin.nam"');
    expect(after).not.toContain("jcm800");
  });

  it("keeps an inline object inline", () => {
    const after = edit(AUTHORED, (d) =>
      setModuleValue(d.at([]), ["ui", "widgets", "w1", "max"], 2),
    );
    expect(after).toContain(
      'w1: { type: "knob", col: 0, row: 0, label: "Mix", bind: "Mix", min: 0, max: 2 },',
    );
  });

  it("adds and removes a key without reformatting", () => {
    const added = edit(AUTHORED, (d) =>
      setModuleValue(d.at([]), ["content"], "the dirty channel"),
    );
    expect(new K7Document(added).getIn(["content"])).toBe("the dirty channel");
    expect(added).toContain("// amp: the head the whole record goes through.");
    const removed = edit(added, (d) =>
      setModuleValue(d.at([]), ["content"], null),
    );
    expect(removed).toBe(AUTHORED);
  });

  it("re-reads what it wrote", () => {
    const after = edit(AUTHORED, (d) =>
      setModuleValue(d.at([]), ["params", "Mix"], 0.25),
    );
    expect(parseModule(after).value?.params?.Mix).toBe(0.25);
  });

  it("writes a list of numbers on one line", () => {
    const long = Array.from({ length: 40 }, (_, i) => i * 1000);
    const after = edit(AUTHORED, (d) =>
      setModuleList(d.at([]), ["channel"], long),
    );
    expect(after).toContain(`channel([${long.join(", ")}])`);
    expect(new K7Document(after).getIn(["channel"])).toEqual(long);
  });

  it("edits under a scope, a chain item's own fields", () => {
    const chain = 'steps([id("a").params({ Mix: 1 })])\n';
    const after = edit(chain, (d) =>
      setModuleValue(d.at(["steps", 0]), ["params", "Mix"], 0.5),
    );
    expect(after).toBe('steps([id("a").params({ Mix: 0.5 })])\n');
  });
});

describe("automations", () => {
  const BASE = 'extends("@k7-core/audio/filter")\n';
  const automations = (text: string) =>
    new K7Document(text).getIn(["automations"]);

  it("binds a curve, replaces it by param, and takes the list away with its last entry", () => {
    const one = edit(BASE, (d) =>
      setModuleAutomation(d.at([]), "Cutoff", "sweep"),
    );
    expect(automations(one)).toEqual([{ param: "Cutoff", curve: "sweep" }]);
    const two = edit(one, (d) =>
      setModuleAutomation(d.at([]), "Cutoff", "env", "kick"),
    );
    expect(automations(two)).toEqual([
      { param: "Cutoff", curve: "env", trigger: "kick" },
    ]);
    const none = edit(two, (d) =>
      setModuleAutomation(d.at([]), "Cutoff", null),
    );
    expect(none).toBe(BASE);
  });

  it("leaves the file alone when taking off a binding that is not there", () => {
    expect(
      edit(BASE, (d) => setModuleAutomation(d.at([]), "Cutoff", null)),
    ).toBe(BASE);
  });

  it("binds into the set that is on when it swaps the module", () => {
    const text = `${BASE}alternatives([{ name: "dark", extends: "@k7-core/audio/lowpass" }])\nalternative("dark")\n`;
    const after = edit(text, (d) =>
      setModuleAutomation(d.at([]), "Cutoff", "sweep"),
    );
    const doc = new K7Document(after);
    expect(doc.getIn(["automations"])).toBeUndefined();
    expect(doc.getIn(["alternatives", 0, "automations"])).toEqual([
      { param: "Cutoff", curve: "sweep" },
    ]);
  });
});

// Tabs are the PANEL's, not a widget: an ordered list of named pages beside the widgets every tab shows.
describe("a panel's tabs", () => {
  const panel = (tabs: unknown) => ({
    cols: 4,
    rows: 2,
    widgets: {},
    tabs,
  });
  const page = (name: string) => ({ name, widgets: {} });

  it("takes an ordered list of named pages", () => {
    expect(
      UISchema.safeParse(panel([page("Osc"), page("Filter")])).success,
    ).toBe(true);
  });

  it("refuses a name past ten characters, and two tabs of one name", () => {
    expect(UISchema.safeParse(panel([page("Oscillators")])).success).toBe(
      false,
    );
    expect(UISchema.safeParse(panel([page("Osc"), page("Osc")])).success).toBe(
      false,
    );
  });

  it("has no `tabs` WIDGET any more — a page is not something placed on the grid", () => {
    const old = {
      cols: 4,
      rows: 2,
      widgets: { t: { type: "tabs", col: 0, row: 0 } },
    };
    expect(UISchema.safeParse(old).success).toBe(false);
  });
});
