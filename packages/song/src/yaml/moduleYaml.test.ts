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

// The spike's evidence. Three questions decide whether YAML can replace CUE for module
// files, and only the third is really about YAML:
//
//   1. does it validate as tightly?      — the errors that mattered today
//   2. does it survive this app's words? — `5:1:1`, `on`, `C4`, `no` (the 1.1 trap)
//   3. does an EDIT keep the file?       — the whole argument; see "editing" below

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
    // The default CUE spells `*"plugin"`, applied on the way out — not into the file.
    expect(value?.type).toBe("plugin");
  });

  it("catches the typo a closed struct is for, and says where", () => {
    // The CUE equivalent was "field not allowed", which is what closed structs bought.
    const { value, issues } = parseModule(
      "plugin:\n  type: internal\nparamz: {}\n",
    );
    expect(value).toBeNull();
    expect(issues[0].message).toMatch(/paramz/);
    expect(issues[0].line).toBeTruthy();
  });

  it("reports a widget field that belongs to another type", () => {
    // Today's bug, three times over: `library` on a non-dropdown, `min` on a toggle.
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

  it("accepts the library dropdown that started all this", () => {
    const { issues } = parseModule(
      M(`
nam: nam/jcm800.nam
ui:
  cols: 4
  rows: 2
  widgets:
    w2: { type: dropdown, col: 0, row: 0, bind: nam, library: nam }
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
    // A slice rack with no source is the error the CUE `if` block caught.
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
    // THE trap. In YAML 1.1 `5:1:1` is 18061 and `on` is `true` — lanes writes both
    // all day (marker timecodes, bypass states). 1.2 is forced in PARSE_OPTIONS; this is
    // what proves it, and what fails the day someone "modernises" that option.
    const { value } = parseModule("docs: 5:1:1\n");
    expect(value?.docs).toBe("5:1:1");
  });

  it("keeps on/off/no as words", () => {
    expect(parseModule("monitor: on\n").value?.monitor).toBe("on");
    expect(parseModule("monitor: off\n").value?.monitor).toBe("off");
    // `no` is a boolean in 1.1 — here it must stay the string a param name could be.
    expect(parseModule("docs: no\n").value?.docs).toBe("no");
  });

  it("keeps a note name and a param name with spaces", () => {
    const { value, issues } = parseModule(
      M(`
params:
  "Filter Freq": 69
  Transpose - Bypass: 1
docs: C4
`),
    );
    expect(issues).toEqual([]);
    expect(value?.params?.["Filter Freq"]).toBe(69);
    expect(value?.params?.["Transpose - Bypass"]).toBe(1);
    expect(value?.docs).toBe("C4");
  });
});

describe("editing", () => {
  // A module file as a human leaves it: a header, a blank line, a comment on a key,
  // inline flow maps, and a deliberate key order. Every one of these is a thing the CUE
  // path had to protect by hand (cueText.ts) and a thing a naive parse→stringify loses.
  const AUTHORED = M(`
# cab: the 4x12 the whole record goes through.
# Swap the IR, not the module.
extends: "@engine/audio/reverb/impulse-response"

# the cabinet — see _library/ir
ir: ir/marshall-1960a.wav

params:
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
    // ONE line. That is the whole case for the Document API: a knob drag is a one-line
    // diff in git, not a reflowed file.
    expect(changed).toEqual(["10:   Level: 0.8 ->   Level: 0.5"]);
  });

  it("keeps every comment", () => {
    const after = setModuleValue(AUTHORED, ["ir"], "ir/vox-ac30.wav");
    expect(after).toContain("# cab: the 4x12 the whole record goes through.");
    expect(after).toContain("# Swap the IR, not the module.");
    expect(after).toContain("# the cabinet — see _library/ir");
    expect(after).toContain("ir: ir/vox-ac30.wav");
    expect(after).not.toContain("marshall");
  });

  it("keeps inline flow maps inline", () => {
    // The widget grid writes these; expanding them to block style on every edit would
    // churn the file and bury the change.
    const after = setModuleValue(AUTHORED, ["ui", "widgets", "w1", "max"], 2);
    expect(after).toContain("w1: { type: knob,");
    expect(after).toContain("max: 2 }");
  });

  it("adds and removes a key without reformatting", () => {
    const added = setModuleValue(AUTHORED, ["nam"], "nam/jcm800.nam");
    expect(added).toContain("nam: nam/jcm800.nam");
    expect(added).toContain("# cab: the 4x12 the whole record goes through.");
    const removed = setModuleValue(added, ["nam"], null);
    expect(removed).toBe(AUTHORED);
  });

  it("re-reads what it wrote", () => {
    const after = setModuleValue(AUTHORED, ["params", "Mix"], 0.25);
    expect(parseModule(after).value?.params?.Mix).toBe(0.25);
  });
});
