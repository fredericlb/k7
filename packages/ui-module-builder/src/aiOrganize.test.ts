// What "AI organize" tells the model and what it refuses from it. The model is not under test —
// the CHECK is: every way a proposal can break the panel must come back as a sentence the model
// can fix, and a good proposal must pass untouched.

import { WIDGET_TYPES } from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import {
  type AiOrganizeResult,
  aiUserPrompt,
  bindableNames,
  checkAiResult,
  readAiAnswer,
} from "./aiOrganize";
import { aiSystemPrompt, WIDGET_DOCS } from "./aiPrompt";

const PARAMS = ["Cutoff", "Resonance", "Attack", "Mode"];

const result = (uiYaml: string, widgetsJs = ""): AiOrganizeResult => ({
  uiYaml,
  widgetsJs,
  notes: "",
});

const GOOD_UI = `# filter
cols: 8
rows: 5
widgets:
  screen: { type: lcdscreen, col: 0, row: 0, colSpan: 8, rowSpan: 2 }
  cutoff: { type: knob, col: 0, row: 2, colSpan: 2, rowSpan: 2, label: Cutoff, bind: Cutoff, min: 20, max: 20000, curve: log }
  res: { type: knob, col: 2, row: 2, colSpan: 2, rowSpan: 2, label: Res, bind: Resonance, min: 0, max: 1 }
`;
const GOOD_JS = `export default {
  screen(lcd) {
    lcd.ctx.fillStyle = "#000";
    lcd.ctx.fillRect(0, 0, lcd.width, lcd.height);
  },
};
`;

describe("the prompt", () => {
  it("describes every widget kind the schema accepts, and no other", () => {
    expect(Object.keys(WIDGET_DOCS).sort()).toEqual([...WIDGET_TYPES].sort());
    for (const t of WIDGET_TYPES)
      expect(aiSystemPrompt()).toContain(`\`${t}\``);
  });

  it("quotes every param name exactly, and the author's direction when there is one", () => {
    const text = aiUserPrompt({
      module: "filter",
      moduleYaml: "extends: '@engine/lowpass'",
      params: [
        { name: "Cutoff", meta: { min: 20, max: 20000 }, value: "440" },
        {
          name: "Mode",
          meta: { min: 0, max: 1, states: [{ label: "LP", value: 0 }] },
        },
      ],
      uiYaml: "",
      widgetsJs: "",
      direction: "  make the screen big ",
    });
    expect(text).toContain('- "Cutoff": range 20..20000, value 440');
    expect(text).toContain('"Mode": states: [{"label":"LP","value":0}]');
    expect(text).toContain("make the screen big");
  });
});

describe("reading the answer", () => {
  it("takes the promised JSON and strips a fence the model should not have added", () => {
    const r = readAiAnswer(
      JSON.stringify({
        ui_yaml: "```yaml\ncols: 1\n```",
        widgets_js: "",
        notes: "n",
      }),
    );
    expect(r).toEqual({ uiYaml: "cols: 1\n", widgetsJs: "", notes: "n" });
  });

  it("is null for anything else", () => {
    expect(readAiAnswer("not json")).toBeNull();
    expect(readAiAnswer(JSON.stringify({ ui_yaml: 3 }))).toBeNull();
  });
});

describe("the check", () => {
  it("passes a sound panel with a drawn screen", () => {
    const { ui, issues } = checkAiResult(result(GOOD_UI, GOOD_JS), PARAMS);
    expect(issues).toEqual([]);
    expect(Object.keys(ui?.widgets ?? {})).toEqual(["screen", "cutoff", "res"]);
  });

  it("names a bind that is not a parameter", () => {
    const bad = GOOD_UI.replace("bind: Resonance", "bind: Reso");
    expect(checkAiResult(result(bad, GOOD_JS), PARAMS).issues).toEqual([
      "`res` binds `Reso`, which is not a parameter",
    ]);
  });

  it("names a screen nothing draws, and a script that does not compile", () => {
    expect(checkAiResult(result(GOOD_UI, ""), PARAMS).issues).toEqual([
      "lcdscreen `screen` has no draw function in widgets_js",
    ]);
    const broken = checkAiResult(result(GOOD_UI, `${GOOD_JS}{`), PARAMS).issues;
    expect(broken[0]).toMatch(/^widgets_js does not compile/);
  });

  it("names overlaps and widgets outside the grid", () => {
    const bad = GOOD_UI.replace("col: 2, row: 2", "col: 1, row: 2").replace(
      "rows: 5",
      "rows: 3",
    );
    const issues = checkAiResult(result(bad, GOOD_JS), PARAMS).issues;
    expect(issues).toContain("panel: `cutoff` runs outside the 8×3 grid");
    expect(issues).toContain("panel: `cutoff` overlaps `res`");
  });

  it("checks each page together with the panel-level widgets drawn over it", () => {
    const tabs = `cols: 8
rows: 6
widgets:
  screen: { type: lcdscreen, col: 0, row: 4, colSpan: 8, rowSpan: 2 }
  tabs:
    type: tabs
    col: 0
    row: 0
    colSpan: 8
    pages:
      Main:
        cutoff: { type: knob, col: 0, row: 1, colSpan: 2, rowSpan: 2, bind: Cutoff, min: 0, max: 1 }
      Env:
        attack: { type: knob, col: 0, row: 3, colSpan: 2, rowSpan: 2, bind: Attack, min: 0, max: 1 }
        cutoff: { type: knob, col: 2, row: 1, bind: Cutoff, min: 0, max: 1 }
`;
    const issues = checkAiResult(result(tabs, GOOD_JS), PARAMS).issues;
    expect(issues).toContain("tabs/Env: `screen` overlaps `attack`");
    expect(issues).toContain("widget id `cutoff` is used twice");
    expect(issues.some((i) => i.startsWith("tabs/Main"))).toBe(false);
  });

  it("hands the schema's own complaint back, with its path", () => {
    const bad = GOOD_UI.replace("label: Res,", "label: Res, options: [],");
    const { ui, issues } = checkAiResult(result(bad, GOOD_JS), PARAMS);
    expect(ui).toBeNull();
    expect(issues[0]).toMatch(/^ui_yaml widgets\.res/);
  });
});

describe("a rack module's taps", () => {
  const KIT = `type: rack
rack:
  symbols:
    BD: { note: 36 }
    SN: { note: 38 }
`;
  const names = bindableNames({
    params: [{ name: "Volume" }],
    moduleYaml: KIT,
  });
  const KIT_UI = `cols: 9
rows: 4
widgets:
  bd: { type: tap, col: 0, row: 0, colSpan: 3, rowSpan: 2, bind: "@rack:BD" }
  sn: { type: tap, col: 3, row: 0, colSpan: 3, rowSpan: 2, bind: "@rack:SN" }
  add: { type: tap, col: 6, row: 0, colSpan: 3, rowSpan: 2, bind: "@rack+" }
  vol: { type: knob, col: 0, row: 2, colSpan: 2, rowSpan: 2, bind: Volume, min: 0, max: 1 }
`;

  it("may be bound to the sounds the module's rack declares, and to the add tap", () => {
    expect(names).toEqual(["Volume", "@rack:BD", "@rack:SN", "@rack+"]);
    expect(checkAiResult(result(KIT_UI), names).issues).toEqual([]);
  });

  it("names a tap on a sound the rack does not have", () => {
    const bad = KIT_UI.replace('"@rack:SN"', '"@rack:HH"');
    expect(checkAiResult(result(bad), names).issues).toEqual([
      "tap `sn` binds `@rack:HH`, which is not a sound of this module's rack",
    ]);
  });

  it("keeps pads on taps, and taps on pads", () => {
    const knobOnPad = KIT_UI.replace("bind: Volume", 'bind: "@rack:BD"');
    const tapOnParam = KIT_UI.replace('"@rack:SN"', "Volume");
    expect(checkAiResult(result(knobOnPad), names).issues).toEqual([
      "`vol` binds a rack sound, which only a tap may",
    ]);
    expect(checkAiResult(result(tapOnParam), names).issues).toEqual([
      "tap `sn` must bind a rack sound or `@rack+`",
    ]);
  });

  it("is offered no tap at all on a module with no rack", () => {
    const plain = bindableNames({
      params: [{ name: "Volume" }],
      moduleYaml: "type: fx\n",
    });
    expect(plain).toEqual(["Volume"]);
    expect(checkAiResult(result(KIT_UI), plain).issues[0]).toBe(
      "tap `bd` binds `@rack:BD`, which is not a sound of this module's rack",
    );
  });

  it("lists the rack's sounds in the prompt", () => {
    const prompt = aiUserPrompt({
      module: "kit",
      moduleYaml: KIT,
      params: [],
      uiYaml: "",
      widgetsJs: "",
      direction: "",
    });
    expect(prompt).toContain("## Rack sounds (2)");
    expect(prompt).toContain('- "@rack:SN"');
  });
});
