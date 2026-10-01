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
import { parseModule, setModuleValue } from "./moduleFile";

// Three questions: does it validate TIGHTLY, does this app's vocabulary survive it, and does an EDIT keep the file.

const M = (body: string) => body.replace(/^\n/, "");

describe("validation", () => {
  it("accepts a module the app actually writes", () => {
    const { value, issues } = parseModule(
      M(`
plugin:
  type: internal
  name: Chorus
ui:
  cols: 4
  rows: 2
  widgets:
    w1: { type: knob, col: 0, row: 0, label: Depth, bind: Depth, min: 0, max: 1 }
`),
    );
    expect(issues).toEqual([]);
    expect(value?.ui?.widgets.w1.bind).toBe("Depth");
    // The schema's default `type: plugin`, applied on the way out — not into the file.
    expect(value?.type).toBe("plugin");
  });

  it("leaves the type unstated when the file extends — the parent's is the answer", () => {
    const { value, issues } = parseModule(
      'extends: "@workspace/instruments/kit"\n',
    );
    expect(issues).toEqual([]);
    // A node over a rack states nothing; a default here would beat the rack it inherits.
    expect(value?.type).toBeUndefined();
  });

  it("takes a label — free text, and the module's own rather than an alternative's", () => {
    const { value, issues } = parseModule(
      'label: "Grande salle"\nplugin: { type: internal, name: Reverb }\n',
    );
    expect(issues).toEqual([]);
    expect(value?.label).toBe("Grande salle");
    // On the module and not in MODULE_FIELDS: an attribute set is a way of PLAYING it, not a second name.
    const alt = parseModule(
      'plugin: { name: Reverb }\nalternatives:\n  - label: "Petite salle"\n',
    );
    expect(alt.value).toBeNull();
    expect(alt.issues[0].message).toMatch(/label/);
  });

  it("catches the typo a closed struct is for, and says where", () => {
    // A closed struct is what makes the typo an error at all — an open one drops `paramz` silently.
    const { value, issues } = parseModule(
      "plugin:\n  type: internal\nparamz: {}\n",
    );
    expect(value).toBeNull();
    expect(issues[0].message).toMatch(/paramz/);
    expect(issues[0].line).toBeTruthy();
  });

  it("reports a widget field that belongs to another type", () => {
    // The common typo, three times over: `library` on a non-dropdown, `min` on a toggle.
    const { issues } = parseModule(
      M(`
ui:
  cols: 1
  rows: 1
  widgets:
    w2: { type: toggle, col: 0, row: 0, bind: Bypass, min: 0 }
`),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("ui.widgets.w2.min");
    expect(issues[0].message).toMatch(/carry a range/);
  });

  it("accepts the asset dropdown that started all this", () => {
    const { issues } = parseModule(
      M(`
params:
  model: jcm800.nam
ui:
  cols: 4
  rows: 2
  widgets:
    w2: { type: dropdown, col: 0, row: 0, bind: model, library: model }
`),
    );
    expect(issues).toEqual([]);
  });

  it("tells a slice rack from a samples one", () => {
    const slice = parseModule(
      M(`
type: rack
rack:
  rack_type: slice
  source: break.wav
  symbols:
    BD: { note: 36, from: 0, to: 0.5 }
`),
    );
    expect(slice.issues).toEqual([]);
    // A slice rack with no source: the flavour's own branch is what catches it.
    const bad = parseModule(
      M(`
type: rack
rack:
  rack_type: slice
  symbols:
    BD: { note: 36, from: 0, to: 0.5 }
`),
    );
    expect(bad.value).toBeNull();
  });
});

describe("this app's vocabulary survives YAML", () => {
  it("keeps a timecode a string, not a sexagesimal number", () => {
    // THE trap: 1.2 is forced in PARSE_OPTIONS, and this fails the day someone "modernises" it.
    const { value } = parseModule("content: 5:1:1\n");
    expect(value?.content).toBe("5:1:1");
  });

  it("keeps on/off/no as words", () => {
    expect(parseModule("monitor: on\n").value?.monitor).toBe("on");
    expect(parseModule("monitor: off\n").value?.monitor).toBe("off");
    // `no` is a boolean in 1.1 — here it must stay the string a param name could be.
    expect(parseModule("content: no\n").value?.content).toBe("no");
  });

  it("keeps a note name and a param name with spaces", () => {
    const { value, issues } = parseModule(
      M(`
params:
  "Filter Freq": 69
  Transpose - Bypass: 1
content: C4
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
# amp: the head the whole record goes through.
# Swap the model, not the module.
extends: "@engine/audio/amp/neural-amp-modeler"

params:
  # the amp — see assets/
  model: jcm800.nam
  Mix: 1
  Level: 0.8

ui:
  cols: 4
  rows: 2
  widgets:
    w1: { type: knob, col: 0, row: 0, label: Mix, bind: Mix, min: 0, max: 1 }
`);

  it("changes one value and touches nothing else", () => {
    const after = setModuleValue(AUTHORED, ["params", "Level"], 0.5);
    const before = AUTHORED.split("\n");
    const now = after.split("\n");
    const changed = now
      .map((l, i) =>
        l === before[i] ? null : `${i + 1}: ${before[i]} -> ${l}`,
      )
      .filter(Boolean);
    // ONE line: the whole case for the Document API — a knob drag is a one-line diff in git.
    expect(changed).toEqual(["9:   Level: 0.8 ->   Level: 0.5"]);
  });

  it("keeps every comment", () => {
    // A file-valued param is edited exactly like a numeric one, which is why it lives in `params:`.
    const after = setModuleValue(AUTHORED, ["params", "model"], "twin.nam");
    expect(after).toContain("# amp: the head the whole record goes through.");
    expect(after).toContain("# Swap the model, not the module.");
    expect(after).toContain("# the amp — see assets/");
    expect(after).toContain("model: twin.nam");
    expect(after).not.toContain("jcm800");
  });

  it("keeps inline flow maps inline", () => {
    // The widget grid writes these, and expanding them to block style would bury the change.
    const after = setModuleValue(AUTHORED, ["ui", "widgets", "w1", "max"], 2);
    expect(after).toContain("w1: { type: knob,");
    expect(after).toContain("max: 2 }");
  });

  it("adds and removes a key without reformatting", () => {
    const added = setModuleValue(AUTHORED, ["content"], "the dirty channel");
    expect(added).toContain("content: the dirty channel");
    expect(added).toContain("# amp: the head the whole record goes through.");
    const removed = setModuleValue(added, ["content"], null);
    expect(removed).toBe(AUTHORED);
  });

  it("re-reads what it wrote", () => {
    const after = setModuleValue(AUTHORED, ["params", "Mix"], 0.25);
    expect(parseModule(after).value?.params?.Mix).toBe(0.25);
  });
});
