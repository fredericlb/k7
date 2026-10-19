// aiOrganize.ts — the WIRE and the CHECK of "AI organize": what the builder sends its host, the
// per-module message the model reads, and the test a proposed panel must pass before it lands
// in a buffer. Pure and React-free, so the host's server imports it too and both ends agree on
// what a valid answer is. The answer's JSON is aiAnswer.ts, the prompt's stable half aiPrompt.ts;
// packages/ui-module-builder/docs/aiOrganize.md.

import type { ParamMeta } from "@studio/engine-protocol";
import { parse } from "@studio/k7x/document";
import {
  INPUT_VOLUME_PARAM,
  MIX_PARAM,
  OUTPUT_VOLUME_PARAM,
  ownLevelSide,
} from "@studio/song-schema/moduleTypes";
import {
  type ModuleUI,
  RACK_ADD_BIND,
  RACK_BIND,
  rackBindSymbol,
  UiFileSchema,
  type Widget,
} from "@studio/song-schema/yaml/moduleSchema";
import type { AiOrganizeResult } from "./aiAnswer";
import { clash, framedBy } from "./groupGeometry";
import { twinIssues } from "./layoutTwins";

/** One param as the model sees it: its exact name, its range and its current value. */
export interface AiParam {
  name: string;
  meta?: ParamMeta;
  value?: string;
}

/** What the builder hands its host — everything the model needs, nothing it could not use. */
export interface AiOrganizeRequest {
  /** The module's name, for the header comment and the model's sense of what it is. */
  module: string;
  /** The module.k7x text: its plugin, its declared params, its label. */
  moduleText: string;
  params: AiParam[];
  /** The panel (`ui.k7x`) and the screens as they are now — sent to the model only on an UPDATE. */
  uiText: string;
  widgetsJs: string;
  /** `update` changes the panel there is; `reset` designs one from the parameters alone — packages/ui-module-builder/docs/aiOrganize.md. */
  mode: AiOrganizeMode;
  /** What the author asked for in their own words: on an update, what to change; on a reset, may be empty. */
  direction: string;
}

/** The two things AI organize can be asked to do with a module that already has a panel. */
export type AiOrganizeMode = "update" | "reset";

/** Whether a panel file lays anything out — the question that decides whether there is a layout to update. */
export function hasLayout(uiText: string): boolean {
  try {
    const widgets = parse(uiText).widgets;
    return (
      !!widgets &&
      typeof widgets === "object" &&
      Object.keys(widgets).length > 0
    );
  } catch {
    // A panel that does not even parse is nothing to update: a reset is what it needs.
    return false;
  }
}

export {
  AI_RESULT_SCHEMA,
  type AiAnswer,
  type AiOrganizeResult,
  readAiAnswer,
} from "./aiAnswer";

/** One line of the answer stream: progress while waiting, then exactly one `done` or `error`. */
export type AiOrganizeEvent =
  | { type: "status"; text: string }
  | { type: "done"; result: AiOrganizeResult }
  | { type: "error"; error: string; issues?: string[] };

/** The account's Claude settings as the browser may see them: the model, and the key only as a hint. */
export interface AiSettingsView {
  model: string | null;
  defaultModel: string;
  keyHint: string | null;
}

/** The sounds module.k7x's own `rack(…)` declares, by symbol; none when it has no rack or does not parse. */
export function rackSymbols(moduleText: string): string[] {
  try {
    const symbols = (parse(moduleText) as { rack?: { symbols?: unknown } }).rack
      ?.symbols;
    return symbols && typeof symbols === "object" ? Object.keys(symbols) : [];
  } catch {
    return [];
  }
}

/** Every bind a proposed panel may carry: the params, and on a rack module its taps — packages/ui-module-builder/docs/aiOrganize.md. */
export function bindableNames(req: {
  params: readonly { name: string }[];
  moduleText: string;
}): string[] {
  const rack = rackSymbols(req.moduleText);
  return [
    ...req.params.map((p) => p.name),
    ...rack.map((sym) => `${RACK_BIND}${sym}`),
    ...(rack.length ? [RACK_ADD_BIND] : []),
  ];
}

/** A param's one line: name, range or settings, and the value, which says where it usually sits. */
function paramLine(p: AiParam): string {
  const m = p.meta;
  const range = m?.states?.length
    ? `states: ${JSON.stringify(m.states)}`
    : m
      ? `range ${m.min}..${m.max}${m.def !== undefined ? `, default ${m.def}` : ""}`
      : "range unknown (use 0..1)";
  const value = p.value !== undefined ? `, value ${p.value}` : "";
  return `- ${JSON.stringify(p.name)}: ${range}${value}`;
}

/** The per-module half of the prompt — everything that changes between two requests. */
export function aiUserPrompt(req: AiOrganizeRequest): string {
  const direction = req.direction.trim();
  const rack = rackSymbols(req.moduleText);
  const update = req.mode === "update";
  return [
    `Module: ${req.module}`,
    "",
    "## module.k7x",
    "```k7x",
    req.moduleText.trim() || "// (empty)",
    "```",
    "",
    `## Parameters (${req.params.length}) — bind names exactly as quoted`,
    ...req.params.map(paramLine),
    "",
    ...(rack.length
      ? [
          `## Rack sounds (${rack.length}) — one \`tap\` each, bound \`${RACK_BIND}<symbol>\`, plus the \`${RACK_ADD_BIND}\` tap`,
          ...rack.map((sym) => `- ${JSON.stringify(`${RACK_BIND}${sym}`)}`),
          "",
        ]
      : []),
    // An UPDATE shows the panel there is; a RESET leaves it out, so nothing of it can leak back in.
    ...(update
      ? [
          "## Current ui.k7x",
          "```k7x",
          req.uiText.trim() || "// (none yet)",
          "```",
          "",
          "## Current widgets.js",
          "```js",
          req.widgetsJs.trim() || "// (none yet)",
          "```",
          "",
          "## Update this panel",
          "Change what the author asks for below and keep everything else as it is — the same widget ids, positions, sizes, binds and screens. Return the whole panel, changed.",
          "",
          `## What to change\n${direction}`,
        ]
      : [
          "## Design a new panel",
          "There is no panel to keep: lay this module out from its parameters alone.",
          ...(direction
            ? ["", `## What the author asks for\n${direction}`]
            : []),
        ]),
  ].join("\n");
}

const span = (n?: number) => Math.max(1, n ?? 1);

/** Every way a set of widgets drawn TOGETHER can break the grid: out of bounds, or on top of another. */
function layoutIssues(
  ui: ModuleUI,
  where: string,
  ws: [string, Widget][],
): string[] {
  const out: string[] = [];
  for (const [id, w] of ws)
    if (w.col + span(w.colSpan) > ui.cols || w.row + span(w.rowSpan) > ui.rows)
      out.push(
        `${where}: \`${id}\` runs outside the ${ui.cols}×${ui.rows} grid`,
      );
  for (let i = 0; i < ws.length; i++)
    for (let j = i + 1; j < ws.length; j++)
      if (clash(ws[i][1], ws[j][1]))
        out.push(
          ws[i][1].type === "group" || ws[j][1].type === "group"
            ? `${where}: \`${ws[i][0]}\` and \`${ws[j][0]}\` cross — a widget lies wholly inside a group or wholly outside it, and groups never overlap`
            : `${where}: \`${ws[i][0]}\` overlaps \`${ws[j][0]}\``,
        );
  return out;
}

const DRY = /\bdry\b/i;
const WET = /\bwet\b/i;
const MIX = /\bmix\b/i;

/** A module with a dry and a wet level and no mix of its own blends through ONE crossfade knob — packages/ui-module-builder/docs/aiOrganize.md. */
export function crossfadeIssues(
  widgets: readonly [string, Widget][],
  bindNames: readonly string[],
): string[] {
  const own = bindNames.filter((n) => !n.startsWith("@"));
  // "Dry/Wet" names both sides at once: that is a mix param, and the module needs no crossfade.
  const isMix = (n: string) => MIX.test(n) || (DRY.test(n) && WET.test(n));
  if (own.some(isMix)) return [];
  const dry = own.find((n) => DRY.test(n));
  const wet = own.find((n) => WET.test(n));
  if (!dry || !wet) return [];
  const out: string[] = [];
  const fix = `one crossfade knob — \`bind: ${wet}, pair: ${dry}\``;
  const dryOn = widgets.find(([, w]) => w.bind === dry);
  const wetOn = widgets.find(([, w]) => w.bind === wet && w.pair !== dry);
  if (dryOn && wetOn)
    out.push(
      `\`${dryOn[0]}\` and \`${wetOn[0]}\` set \`${dry}\` and \`${wet}\` apart: blend them with ${fix}`,
    );
  for (const [id, w] of widgets)
    if (w.bind === dry && w.pair === wet)
      out.push(`\`${id}\` is a crossfade knob the wrong way round: ${fix}`);
  return out;
}

/** Where the engine offers `@mix`, the blend is THAT knob and the plugin's own mix, dry and wet stay off — packages/ui-module-builder/docs/aiOrganize.md. */
export function blendIssues(widgets: readonly [string, Widget][]): string[] {
  const own = (n: string) =>
    !n.startsWith("@") && (MIX.test(n) || DRY.test(n) || WET.test(n));
  const out: string[] = [];
  for (const [id, w] of widgets)
    if (w.pair || (w.bind && own(w.bind)))
      out.push(
        `\`${id}\` blends with the plugin's own ${w.pair ? "dry and wet" : `\`${w.bind}\``}: the blend is the engine's \`${MIX_PARAM}\`, drawn in the card's footer — leave it off the panel`,
      );
  return out;
}

/** Where the engine offers a level, the plugin's own input or output level stays off the panel — packages/ui-module-builder/docs/aiOrganize.md. */
export function levelIssues(
  widgets: readonly [string, Widget][],
  bindNames: readonly string[],
): string[] {
  const out: string[] = [];
  for (const [id, w] of widgets) {
    const side =
      w.bind && !w.bind.startsWith("@") ? ownLevelSide(w.bind) : null;
    const engine =
      side === "input"
        ? INPUT_VOLUME_PARAM
        : side === "output"
          ? OUTPUT_VOLUME_PARAM
          : null;
    if (engine && bindNames.includes(engine))
      out.push(
        `\`${id}\` binds the plugin's own \`${w.bind}\`: the level ${side === "input" ? "in" : "out"} is the engine's \`${engine}\`, drawn in the card's footer — leave it off the panel`,
      );
  }
  return out;
}

// An EQ or tone BAND by its name: "Low", "Mid gain 1", "High-shelf gain", "Presnce" (a plugin's own spelling).
const EQ_BAND =
  /^(low|lo|mid|mids|high|hi|bass|treble|presence|presnce|pres)(\s*-?\s*(shelf|peak|band))?(\s+(gain|level|eq))?(\s*\d+)?$/i;

/** An EQ band is a fader, never a knob: side by side, the faders draw the curve — packages/ui-module-builder/docs/aiOrganize.md. */
export function eqBandIssues(widgets: readonly [string, Widget][]): string[] {
  return widgets
    .filter(
      ([, w]) => w.type === "knob" && !!w.bind && EQ_BAND.test(w.bind.trim()),
    )
    .map(
      ([id, w]) =>
        `\`${id}\` is a knob on \`${w.bind}\`, an EQ band: make it a fader (1 column × 3+ rows) beside the other bands`,
    );
}

/** No control on an `@` param: k7 draws the engine's stage in the card's footer, a lane's on its strip — packages/ui-module-builder/docs/aiOrganize.md. */
export function atControlIssues(
  widgets: readonly [string, Widget][],
): string[] {
  const CONTROLS = new Set(["knob", "slider", "fader", "number"]);
  return widgets
    .filter(
      ([, w]) =>
        CONTROLS.has(w.type) &&
        !!w.bind?.startsWith("@") &&
        // A rack's sounds have their own rule: a pad is a tap's, said once below.
        w.bind !== RACK_ADD_BIND &&
        rackBindSymbol(w.bind) === null,
    )
    .map(
      ([id, w]) =>
        `\`${id}\` puts a ${w.type} on \`${w.bind}\`: k7 draws that in the card's footer — leave \`@\` params off the panel`,
    );
}

/** A group frames a SECTION: one around a single widget is a tint, not a grouping — packages/ui-module-builder/docs/aiOrganize.md. */
export function loneGroupIssues(
  widgets: readonly [string, Widget][],
): string[] {
  const map = Object.fromEntries(widgets);
  const out: string[] = [];
  for (const [id, w] of widgets) {
    if (w.type !== "group") continue;
    const n = framedBy(map, w).length;
    if (n < 2)
      out.push(
        `group \`${id}\` frames ${n === 0 ? "nothing" : "a single widget"}: a group holds two or more — drop it${n ? " and leave the widget bare" : ""}`,
      );
  }
  return out;
}

// A draw function for `id` in widgets.js: `id(lcd) {`, `id: (lcd) =>`, `"id": function…`.
const drawsFor = (script: string, id: string) =>
  new RegExp(
    `["']?\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b["']?\\s*(\\(|:)`,
  ).test(script);

/** The script's syntax, checked by COMPILING it without calling it — nothing in it runs here. */
function scriptSyntaxError(script: string): string | null {
  const body = script.replace(/^\s*export\s+default\s+/m, "return ");
  try {
    // Compiled and dropped, never called: the syntax is the question, not the behaviour.
    new Function(`"use strict";\n${body}`);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// An interactive screen's handler in widgets.js: `pointer(lcd, ev) {` or `pointer: (lcd, ev) =>`.
const POINTER = /\bpointer\s*(\(|:)/;

/** Does the author's direction ask for a screen you can touch? Words, in English or French — packages/ui-module-builder/docs/aiOrganize.md. */
export function asksForInteraction(direction: string): boolean {
  return /interacti|\bdrag|\bclick|\btouch|\bpointer|\bmouse|\bgrab|editable|glisse|clique|souris|déplac|éditable/i.test(
    direction,
  );
}

/** A screen takes the pointer only when the author asked, or an update keeps one that already did. */
export function interactiveIssues(
  script: string,
  req: Pick<AiOrganizeRequest, "direction" | "widgetsJs" | "mode">,
): string[] {
  if (!POINTER.test(script)) return [];
  if (asksForInteraction(req.direction)) return [];
  if (req.mode === "update" && POINTER.test(req.widgetsJs)) return [];
  return [
    "widgets_js gives a screen a `pointer` handler, and the author did not ask for an interactive screen: make every screen a plain draw function",
  ];
}

/** Why a proposal must not land, as sentences the MODEL can act on; empty means it may. */
export function checkAiResult(
  res: AiOrganizeResult & { issues?: readonly string[] },
  bindNames: readonly string[],
  /** The request, when the caller has it: what decides whether a screen may be interactive. */
  req?: Pick<AiOrganizeRequest, "direction" | "widgetsJs" | "mode">,
): { ui: ModuleUI | null; issues: string[] } {
  let raw: unknown;
  try {
    raw = parse(res.uiText);
  } catch (e) {
    return {
      ui: null,
      issues: [`the panel does not read as k7x: ${(e as Error).message}`],
    };
  }
  const parsed = UiFileSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ui: null,
      issues: parsed.error.issues.map(
        (i) => `panel ${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  const ui = parsed.data;
  const issues: string[] = [...(res.issues ?? [])];
  const known = new Set(bindNames);
  const top = Object.entries(ui.widgets);
  // The panel's own widgets are drawn on EVERY tab, so each tab is checked together with them.
  const all: [string, Widget][] = [...top];
  issues.push(...layoutIssues(ui, "panel", top));
  for (const t of ui.tabs ?? []) {
    const inTab = Object.entries(t.widgets);
    all.push(...inTab);
    issues.push(...layoutIssues(ui, `tab ${t.name}`, [...top, ...inTab]));
  }
  const seen = new Set<string>();
  for (const [id, w] of all) {
    if (seen.has(id)) issues.push(`widget id \`${id}\` is used twice`);
    seen.add(id);
    const pad = w.bind === RACK_ADD_BIND || rackBindSymbol(w.bind) !== null;
    // A pad is a tap's and a tap is a pad: either one alone draws a card that plays nothing.
    if (w.type === "tap" && !pad)
      issues.push(
        `tap \`${id}\` must bind a rack sound or \`${RACK_ADD_BIND}\``,
      );
    else if (pad && w.type !== "tap")
      issues.push(`\`${id}\` binds a rack sound, which only a tap may`);
    else if (w.bind && !known.has(w.bind))
      issues.push(
        pad
          ? `tap \`${id}\` binds \`${w.bind}\`, which is not a sound of this module's rack`
          : `\`${id}\` binds \`${w.bind}\`, which is not a parameter`,
      );
    if (w.pair && !known.has(w.pair))
      issues.push(`\`${id}\` pairs \`${w.pair}\`, which is not a parameter`);
    if (w.type === "lcdscreen" && !drawsFor(res.widgetsJs, id))
      issues.push(`lcdscreen \`${id}\` has no draw function in widgets_js`);
  }
  issues.push(
    ...(bindNames.includes(MIX_PARAM)
      ? blendIssues(all)
      : crossfadeIssues(all, bindNames)),
  );
  // The panel's two shapes — sizes, the vertical one's geometry, the same controls on every page (layouts.md).
  issues.push(...twinIssues(ui));
  issues.push(...loneGroupIssues(top));
  issues.push(...atControlIssues(all));
  issues.push(...eqBandIssues(all));
  issues.push(...levelIssues(all, bindNames));
  for (const t of ui.tabs ?? [])
    issues.push(...loneGroupIssues(Object.entries(t.widgets)));
  if (res.widgetsJs.trim()) {
    const err = scriptSyntaxError(res.widgetsJs);
    if (err) issues.push(`widgets_js does not compile: ${err}`);
  }
  issues.push(
    ...interactiveIssues(
      res.widgetsJs,
      req ?? { direction: "", widgetsJs: "", mode: "reset" },
    ),
  );
  return { ui, issues };
}
