// What "AI organize" tells the model and what it refuses from it. The model is not under test —
// the CHECK is: every way a proposal can break the panel must come back as a sentence the model
// can fix, and a good proposal must pass untouched.

import {
  WIDGET_TYPES,
  type Widget,
} from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import {
  type AiOrganizeResult,
  aiUserPrompt,
  atControlIssues,
  bindableNames,
  blendIssues,
  checkAiResult,
  crossfadeIssues,
  eqBandIssues,
  hasLayout,
  levelIssues,
  loneGroupIssues,
  readAiAnswer,
} from "./aiOrganize";
import { aiSystemPrompt, WIDGET_DOCS } from "./aiPrompt";
import { twinIssues } from "./layoutTwins";

const PARAMS = ["Cutoff", "Resonance", "Attack", "Mode"];

/** The check MINUS its two-layout findings — these fixtures are about binds, screens, frames and racks; the shapes have their own test below. */
const checkOther = (...a: Parameters<typeof checkAiResult>) => {
  const r = checkAiResult(...a);
  const shape = new Set(r.ui ? twinIssues(r.ui) : []);
  return { ...r, issues: r.issues.filter((i) => !shape.has(i)) };
};

const result = (uiText: string, widgetsJs = ""): AiOrganizeResult => ({
  uiText,
  widgetsJs,
  notes: "",
});

const GOOD_WIDGETS = `  screen: { type: "lcdscreen", col: 0, row: 0, colSpan: 8, rowSpan: 2 },
  cutoff: { type: "knob", col: 0, row: 2, colSpan: 2, rowSpan: 2, label: "Cutoff", bind: "Cutoff", min: 20, max: 20000, curve: "log" },
  res: { type: "knob", col: 2, row: 2, colSpan: 2, rowSpan: 2, label: "Res", bind: "Resonance", min: 0, max: 1 },
`;
/** The filter's panel, with more widget lines added to its map. */
const goodUi = (more = "") =>
  `// filter\ncols(8)\nrows(5)\nwidgets({\n${GOOD_WIDGETS}${more}})\n`;
const GOOD_UI = goodUi();
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
      moduleText: 'extends("@engine/lowpass")',
      params: [
        { name: "Cutoff", meta: { min: 20, max: 20000 }, value: "440" },
        {
          name: "Mode",
          meta: { min: 0, max: 1, states: [{ label: "LP", value: 0 }] },
        },
      ],
      uiText: "",
      widgetsJs: "",
      mode: "reset",
      direction: "  make the screen big ",
    });
    expect(text).toContain('- "Cutoff": range 20..20000, value 440');
    expect(text).toContain('"Mode": states: [{"label":"LP","value":0}]');
    expect(text).toContain("make the screen big");
  });
});

describe("reading the answer", () => {
  const answer = (panel: unknown, extra: object = {}) =>
    JSON.stringify({
      header: "filter — a low pass",
      panel,
      widgets_js: "```js\nexport default {};\n```",
      notes: "n",
      ...extra,
    });

  it("prints the panel's data as ui.k7x, a widget a line, and strips a fence off the script", () => {
    const r = readAiAnswer(
      answer({
        cols: 4,
        rows: 2,
        widgets: [
          { id: "cut", type: "knob", col: 0, row: 0, bind: "Cutoff" },
          { id: "res", type: "knob", col: 2, row: 0, bind: "Resonance" },
        ],
        tabs: [],
      }),
    );
    expect(r).toEqual({
      uiText: `// filter — a low pass
cols(4)
rows(2)
widgets({
  cut: { type: "knob", col: 0, row: 0, bind: "Cutoff" },
  res: { type: "knob", col: 2, row: 0, bind: "Resonance" },
})
`,
      widgetsJs: "export default {};\n",
      notes: "n",
    });
  });

  it("turns the tabs' and the vertical twin's lists into maps too", () => {
    const w = { id: "cut", type: "knob", col: 0, row: 0, bind: "Cutoff" };
    const r = readAiAnswer(
      answer({
        cols: 8,
        rows: 2,
        widgets: [],
        tabs: [{ name: "Main", widgets: [w] }],
        vertical: {
          cols: 4,
          rows: 2,
          widgets: [w],
          tabs: [{ name: "Main", widgets: [] }],
        },
      }),
    );
    const ui = r ? checkAiResult(r, ["Cutoff"]).ui : null;
    expect(ui?.tabs?.[0].widgets.cut.bind).toBe("Cutoff");
    expect(ui?.vertical?.widgets.cut.type).toBe("knob");
  });

  it("reports an id used twice in one list rather than losing a widget silently", () => {
    const w = { id: "cut", type: "knob", col: 0, row: 0, bind: "Cutoff" };
    const r = readAiAnswer(
      answer({ cols: 4, rows: 2, widgets: [w, { ...w, col: 2 }] }),
    );
    if (!r) throw new Error("the answer did not read");
    expect(r.issues).toEqual(["panel: widget id `cut` is used twice"]);
    expect(checkAiResult(r, ["Cutoff"]).issues).toContain(
      "panel: widget id `cut` is used twice",
    );
  });

  it("is null for anything else", () => {
    expect(readAiAnswer("not json")).toBeNull();
    expect(readAiAnswer(JSON.stringify({ panel: 3 }))).toBeNull();
    expect(readAiAnswer(answer({ cols: 1 }, { widgets_js: 3 }))).toBeNull();
  });
});

describe("the check", () => {
  it("passes a sound panel with a drawn screen", () => {
    const { ui, issues } = checkOther(result(GOOD_UI, GOOD_JS), PARAMS);
    expect(issues).toEqual([]);
    expect(Object.keys(ui?.widgets ?? {})).toEqual(["screen", "cutoff", "res"]);
  });

  it("refuses an interactive screen nobody asked for, and takes one that was asked for", () => {
    const touch =
      "export default { screen: { draw(lcd) {}, pointer(lcd, ev) { return true; } } };";
    const req = (
      direction: string,
      mode: "update" | "reset" = "reset",
      widgetsJs = "",
    ) => ({
      direction,
      widgetsJs,
      mode,
    });
    expect(
      checkOther(result(GOOD_UI, touch), PARAMS, req("tidy it")).issues,
    ).toEqual([
      "widgets_js gives a screen a `pointer` handler, and the author did not ask for an interactive screen: make every screen a plain draw function",
    ]);
    expect(checkOther(result(GOOD_UI, touch), PARAMS).issues).toHaveLength(1);
    expect(
      checkOther(
        result(GOOD_UI, touch),
        PARAMS,
        req("let me drag the cutoff on the screen"),
      ).issues,
    ).toEqual([]);
    // An update keeps an interactive screen that already was one.
    expect(
      checkOther(
        result(GOOD_UI, touch),
        PARAMS,
        req("bigger knobs", "update", touch),
      ).issues,
    ).toEqual([]);
  });

  it("names a bind that is not a parameter", () => {
    const bad = GOOD_UI.replace('bind: "Resonance"', 'bind: "Reso"');
    expect(checkOther(result(bad, GOOD_JS), PARAMS).issues).toEqual([
      "`res` binds `Reso`, which is not a parameter",
    ]);
  });

  it("names a screen nothing draws, and a script that does not compile", () => {
    expect(checkOther(result(GOOD_UI, ""), PARAMS).issues).toEqual([
      "lcdscreen `screen` has no draw function in widgets_js",
    ]);
    const broken = checkOther(result(GOOD_UI, `${GOOD_JS}{`), PARAMS).issues;
    expect(broken[0]).toMatch(/^widgets_js does not compile/);
  });

  it("names overlaps and widgets outside the grid", () => {
    const bad = GOOD_UI.replace("col: 2, row: 2", "col: 1, row: 2").replace(
      "rows(5)",
      "rows(3)",
    );
    const issues = checkOther(result(bad, GOOD_JS), PARAMS).issues;
    expect(issues).toContain("panel: `cutoff` runs outside the 8×3 grid");
    expect(issues).toContain("panel: `cutoff` overlaps `res`");
  });

  it("checks each tab together with the panel-level widgets drawn over it", () => {
    const tabs = `cols(8)
rows(6)
widgets({
  screen: { type: "lcdscreen", col: 0, row: 4, colSpan: 8, rowSpan: 2 },
})
tabs([
  name("Main").widgets({
    cutoff: { type: "knob", col: 0, row: 0, colSpan: 2, rowSpan: 2, bind: "Cutoff", min: 0, max: 1 },
  }),
  name("Env").widgets({
    attack: { type: "knob", col: 0, row: 3, colSpan: 2, rowSpan: 2, bind: "Attack", min: 0, max: 1 },
    cutoff: { type: "knob", col: 2, row: 0, bind: "Cutoff", min: 0, max: 1 },
  }),
])
`;
    const issues = checkOther(result(tabs, GOOD_JS), PARAMS).issues;
    expect(issues).toContain("tab Env: `screen` overlaps `attack`");
    expect(issues).toContain("widget id `cutoff` is used twice");
    expect(issues.some((i) => i.startsWith("tab Main"))).toBe(false);
  });

  it("lets a group frame the widgets wholly inside it, and names one that straddles its edge", () => {
    const grouped = goodUi(
      `  filt: { type: "group", col: 0, row: 2, colSpan: 4, rowSpan: 2, label: "FILTER", color: "#3d7dff26" },\n`,
    );
    expect(checkOther(result(grouped, GOOD_JS), PARAMS).issues).toEqual([]);
    const straddling = grouped.replace(
      'colSpan: 4, rowSpan: 2, label: "FILTER"',
      'colSpan: 3, rowSpan: 2, label: "FILTER"',
    );
    expect(checkOther(result(straddling, GOOD_JS), PARAMS).issues).toContain(
      "panel: `res` and `filt` cross — a widget lies wholly inside a group or wholly outside it, and groups never overlap",
    );
  });

  it("takes a crossfade knob on a dry and a wet param, and names a pair that is not a parameter", () => {
    const xf = (pair: string) =>
      goodUi(
        `  mix: { type: "knob", col: 4, row: 2, label: "MIX", bind: "Attack", pair: "${pair}" },\n`,
      );
    expect(checkOther(result(xf("Mode"), GOOD_JS), PARAMS).issues).toEqual([]);
    expect(checkOther(result(xf("Dry"), GOOD_JS), PARAMS).issues).toEqual([
      "`mix` pairs `Dry`, which is not a parameter",
    ]);
  });

  it("refuses a pair anywhere but on a knob, and one equal to its bind", () => {
    const onSlider = goodUi(
      `  s: { type: "slider", col: 4, row: 2, bind: "Attack", pair: "Mode" },\n`,
    );
    expect(checkOther(result(onSlider, GOOD_JS), PARAMS).issues[0]).toMatch(
      /^panel widgets\.s\.pair/,
    );
    const same = goodUi(
      `  k: { type: "knob", col: 4, row: 2, bind: "Attack", pair: "Attack" },\n`,
    );
    expect(checkOther(result(same, GOOD_JS), PARAMS).issues[0]).toMatch(
      /^panel widgets\.k\.pair/,
    );
  });

  it("refuses a colour anywhere but on a group, and takes a group's on/off bind", () => {
    const bad = GOOD_UI.replace(
      'label: "Res",',
      'label: "Res", color: "#fff",',
    );
    expect(checkOther(result(bad, GOOD_JS), PARAMS).issues[0]).toMatch(
      /^panel widgets\.res\.color/,
    );
    const bound = goodUi(
      `  g: { type: "group", col: 4, row: 2, bind: "Cutoff" },\n`,
    );
    expect(
      checkOther(result(bound, GOOD_JS), PARAMS).issues.filter((i) =>
        i.startsWith("panel widgets.g.bind"),
      ),
    ).toEqual([]);
  });

  it("hands the schema's own complaint back, with its path", () => {
    const bad = GOOD_UI.replace('label: "Res",', 'label: "Res", options: [],');
    const { ui, issues } = checkOther(result(bad, GOOD_JS), PARAMS);
    expect(ui).toBeNull();
    expect(issues[0]).toMatch(/^panel widgets\.res/);
  });
});

describe("a rack module's taps", () => {
  const KIT = `type("rack")
rack({ symbols: { BD: { note: 36 }, SN: { note: 38 } } })
`;
  const names = bindableNames({
    params: [{ name: "Volume" }],
    moduleText: KIT,
  });
  const KIT_UI = `cols(9)
rows(4)
widgets({
  bd: { type: "tap", col: 0, row: 0, colSpan: 3, rowSpan: 2, bind: "@rack:BD" },
  sn: { type: "tap", col: 3, row: 0, colSpan: 3, rowSpan: 2, bind: "@rack:SN" },
  add: { type: "tap", col: 6, row: 0, colSpan: 3, rowSpan: 2, bind: "@rack+" },
  vol: { type: "knob", col: 0, row: 2, colSpan: 2, rowSpan: 2, bind: "Volume", min: 0, max: 1 },
})
`;

  it("may be bound to the sounds the module's rack declares, and to the add tap", () => {
    expect(names).toEqual(["Volume", "@rack:BD", "@rack:SN", "@rack+"]);
    expect(checkOther(result(KIT_UI), names).issues).toEqual([]);
  });

  it("names a tap on a sound the rack does not have", () => {
    const bad = KIT_UI.replace('"@rack:SN"', '"@rack:HH"');
    expect(checkOther(result(bad), names).issues).toEqual([
      "tap `sn` binds `@rack:HH`, which is not a sound of this module's rack",
    ]);
  });

  it("keeps pads on taps, and taps on pads", () => {
    const knobOnPad = KIT_UI.replace('bind: "Volume"', 'bind: "@rack:BD"');
    const tapOnParam = KIT_UI.replace('"@rack:SN"', '"Volume"');
    expect(checkOther(result(knobOnPad), names).issues).toEqual([
      "`vol` binds a rack sound, which only a tap may",
    ]);
    expect(checkOther(result(tapOnParam), names).issues).toEqual([
      "tap `sn` must bind a rack sound or `@rack+`",
    ]);
  });

  it("is offered no tap at all on a module with no rack", () => {
    const plain = bindableNames({
      params: [{ name: "Volume" }],
      moduleText: 'type("fx")\n',
    });
    expect(plain).toEqual(["Volume"]);
    expect(checkOther(result(KIT_UI), plain).issues[0]).toBe(
      "tap `bd` binds `@rack:BD`, which is not a sound of this module's rack",
    );
  });

  it("lists the rack's sounds in the prompt", () => {
    const prompt = aiUserPrompt({
      module: "kit",
      moduleText: KIT,
      params: [],
      uiText: "",
      widgetsJs: "",
      mode: "reset",
      direction: "",
    });
    expect(prompt).toContain("## Rack sounds (2)");
    expect(prompt).toContain('- "@rack:SN"');
  });
});

describe("update or reset", () => {
  const req = (mode: "update" | "reset", direction: string) => ({
    module: "filter",
    moduleText: "",
    params: [{ name: "Cutoff" }],
    uiText: GOOD_UI,
    widgetsJs: GOOD_JS,
    mode,
    direction,
  });

  it("knows a panel that lays something out from one that does not", () => {
    expect(hasLayout(GOOD_UI)).toBe(true);
    expect(hasLayout("cols(8)\nrows(5)\nwidgets({})\n")).toBe(false);
    expect(hasLayout("")).toBe(false);
    expect(hasLayout("widgets([unclosed")).toBe(false);
  });

  it("sends the panel there is, and what to change, on an update", () => {
    const text = aiUserPrompt(req("update", "make the cutoff bigger"));
    expect(text).toContain("## Current ui.k7x");
    expect(text).toContain('cutoff: { type: "knob"');
    expect(text).toContain("## Current widgets.js");
    expect(text).toContain("## What to change\nmake the cutoff bigger");
    expect(text).toContain("keep everything else as it is");
  });

  it("sends no panel at all on a reset, so none of it can come back", () => {
    const text = aiUserPrompt(req("reset", ""));
    expect(text).not.toContain("## Current ui.k7x");
    expect(text).not.toContain('cutoff: { type: "knob"');
    expect(text).not.toContain("widgets.js");
    expect(text).toContain("## Design a new panel");
    expect(text).not.toContain("## What the author asks for");
  });
});

describe("the crossfade check", () => {
  const knob = (bind: string, pair?: string): Widget => ({
    type: "knob",
    col: 0,
    row: 0,
    bind,
    ...(pair ? { pair } : {}),
  });
  const PARAMS_DW = ["@pan", "Delay", "Dry Level", "Wet Level"];

  it("refuses a dry and a wet level set by two widgets", () => {
    expect(
      crossfadeIssues(
        [
          ["dry", knob("Dry Level")],
          ["wet", knob("Wet Level")],
        ],
        PARAMS_DW,
      ),
    ).toEqual([
      "`dry` and `wet` set `Dry Level` and `Wet Level` apart: blend them with one crossfade knob — `bind: Wet Level, pair: Dry Level`",
    ]);
  });

  it("takes one crossfade knob, and names one wired the wrong way round", () => {
    expect(
      crossfadeIssues([["mix", knob("Wet Level", "Dry Level")]], PARAMS_DW),
    ).toEqual([]);
    expect(
      crossfadeIssues([["mix", knob("Dry Level", "Wet Level")]], PARAMS_DW),
    ).toHaveLength(1);
  });

  it("asks nothing of a module that has a mix of its own", () => {
    const two: [string, Widget][] = [
      ["dry", knob("Dry Level")],
      ["wet", knob("Wet Level")],
    ];
    expect(crossfadeIssues(two, [...PARAMS_DW, "Mix"])).toEqual([]);
    expect(crossfadeIssues(two, [...PARAMS_DW, "Dry/Wet"])).toEqual([]);
  });
});

describe("a group around one widget", () => {
  const knob = (col: number): Widget => ({
    type: "knob",
    col,
    row: 0,
    colSpan: 2,
    rowSpan: 2,
  });
  const group = (colSpan: number): Widget => ({
    type: "group",
    col: 0,
    row: 0,
    colSpan,
    rowSpan: 2,
  });

  it("is refused, and so is one around nothing", () => {
    expect(
      loneGroupIssues([
        ["g", group(2)],
        ["a", knob(0)],
      ]),
    ).toEqual([
      "group `g` frames a single widget: a group holds two or more — drop it and leave the widget bare",
    ]);
    expect(loneGroupIssues([["g", group(2)]])).toEqual([
      "group `g` frames nothing: a group holds two or more — drop it",
    ]);
  });

  it("passes a group around a section", () => {
    expect(
      loneGroupIssues([
        ["g", group(4)],
        ["a", knob(0)],
        ["b", knob(2)],
      ]),
    ).toEqual([]);
  });

  it("is checked inside a tab as well", () => {
    const tabs = `cols(8)
rows(6)
widgets({})
tabs([
  name("Main").widgets({
    g: { type: "group", col: 0, row: 0, colSpan: 2, rowSpan: 2 },
    cutoff: { type: "knob", col: 0, row: 0, colSpan: 2, rowSpan: 2, bind: "Cutoff", min: 0, max: 1 },
  }),
  name("Env").widgets({}),
])
`;
    expect(checkOther(result(tabs, GOOD_JS), PARAMS).issues).toContain(
      "group `g` frames a single widget: a group holds two or more — drop it and leave the widget bare",
    );
  });
});

describe("the engine's blend", () => {
  const knob = (bind: string, pair?: string): Widget => ({
    type: "knob",
    col: 0,
    row: 0,
    bind,
    ...(pair ? { pair } : {}),
  });

  it("leaves @mix itself to the footer rule", () => {
    expect(blendIssues([["mix", knob("@mix")]])).toEqual([]);
  });

  it("refuses the plugin's own mix, dry or wet, and a crossfade, asking for @mix instead", () => {
    const issues = blendIssues([
      ["m", knob("Mix")],
      ["d", knob("Dry Level")],
      ["x", knob("Wet Level", "Dry Level")],
    ]);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toBe(
      "`m` blends with the plugin's own `Mix`: the blend is the engine's `@mix`, drawn in the card's footer — leave it off the panel",
    );
  });

  it("is what the check applies wherever @mix is offered", () => {
    const ui = `cols(4)
rows(2)
widgets({
  d: { type: "knob", col: 0, row: 0, bind: "Dry Level" },
  w: { type: "knob", col: 1, row: 0, bind: "Wet Level" },
})
`;
    const issues = checkOther(result(ui, ""), [
      "Dry Level",
      "Wet Level",
      "@mix",
    ]).issues;
    expect(issues.some((i) => i.includes("the blend is the engine's"))).toBe(
      true,
    );
    expect(issues.some((i) => i.includes("crossfade knob — `bind"))).toBe(
      false,
    );
  });
});

describe("the engine's levels", () => {
  const knob = (bind: string): Widget => ({
    type: "knob",
    col: 0,
    row: 0,
    bind,
  });

  it("refuse the plugin's own input and output where the engine offers them", () => {
    const names = [
      "Input",
      "Output",
      "Drive",
      "@input-volume",
      "@output-volume",
    ];
    expect(
      levelIssues(
        [
          ["i", knob("Input")],
          ["o", knob("Output")],
          ["d", knob("Drive")],
        ],
        names,
      ),
    ).toEqual([
      "`i` binds the plugin's own `Input`: the level in is the engine's `@input-volume`, drawn in the card's footer — leave it off the panel",
      "`o` binds the plugin's own `Output`: the level out is the engine's `@output-volume`, drawn in the card's footer — leave it off the panel",
    ]);
  });

  it("leave a plugin's own level alone where the engine offers none", () => {
    expect(levelIssues([["o", knob("Output")]], ["Output"])).toEqual([]);
  });

  it("are the card's footer, never a control on the panel", () => {
    expect(atControlIssues([["in", knob("@input-volume")]])).toEqual([
      "`in` puts a knob on `@input-volume`: k7 draws that in the card's footer — leave `@` params off the panel",
    ]);
    // A dropdown on `@base` is not a level: it picks the preset the plugin is built from.
    expect(
      atControlIssues([
        ["b", { type: "dropdown", col: 0, row: 0, bind: "@base" }],
      ]),
    ).toEqual([]);
  });
});

describe("an EQ band", () => {
  const w = (type: "knob" | "fader", bind: string): Widget => ({
    type,
    col: 0,
    row: 0,
    bind,
  });

  it("is refused as a knob, whatever the plugin calls it", () => {
    for (const bind of [
      "Low",
      "Mid gain 1",
      "High-shelf gain",
      "Presnce",
      "Bass",
      "Treble",
    ])
      expect(eqBandIssues([["b", w("knob", bind)]]), bind).toHaveLength(1);
  });

  it("passes as a fader, and leaves every other knob alone", () => {
    expect(eqBandIssues([["b", w("fader", "Low")]])).toEqual([]);
    for (const bind of ["Drive", "Low Cut", "High Freq", "Cutoff"])
      expect(eqBandIssues([["b", w("knob", bind)]]), bind).toEqual([]);
  });
});

describe("the two layouts", () => {
  const KNOBS = `    cutoff: { type: "knob", col: 0, row: 0, colSpan: 2, rowSpan: 2, label: "Cutoff", bind: "Cutoff", min: 20, max: 20000, curve: "log" },
    res: { type: "knob", col: 2, row: 0, colSpan: 2, rowSpan: 2, label: "Res", bind: "Resonance", min: 0, max: 1 },
`;
  const H = `cols(8)\nrows(2)\nwidgets({\n${KNOBS.replace(/^ {2}/gm, "")}})\n`;
  it("asks for a vertical layout when the panel is wider than four columns", () => {
    const r = checkAiResult(result(H), PARAMS);
    expect(r.issues.join(" ")).toMatch(/no `vertical` layout/);
  });

  it("takes a vertical layout offering the same controls, and names one that drops a control", () => {
    const twin = `${H}vertical({\n  cols: 4,\n  rows: 4,\n  widgets: {\n${KNOBS}  },\n})\n`;
    expect(checkAiResult(result(twin), PARAMS).issues).toEqual([]);
    const short = twin.replace(/\n {4}res: [^\n]*(?=\n {2}\},\n\}\)\n$)/, "");
    expect(checkAiResult(result(short), PARAMS).issues.join(" ")).toMatch(
      /does not offer the same controls/,
    );
  });
});
