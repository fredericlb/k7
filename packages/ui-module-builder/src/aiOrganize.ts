// aiOrganize.ts — the WIRE and the CHECK of "AI organize": what the builder sends its host, the
// per-module message the model reads, and the test a proposed panel must pass before it lands
// in a buffer. Pure and React-free, so the host's server imports it too and both ends agree on
// what a valid answer is. The prompt's stable half is aiPrompt.ts; docs/aiOrganize.md.

import type { ParamMeta } from "@studio/engine-protocol";
import {
  type ModuleUI,
  RACK_ADD_BIND,
  RACK_BIND,
  rackBindSymbol,
  UiFileSchema,
  type Widget,
} from "@studio/song-schema/yaml/moduleSchema";
import { parse } from "yaml";

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
  /** The module.yaml text: its plugin, its declared params, its label. */
  moduleYaml: string;
  params: AiParam[];
  /** The panel and the screens as they are now, so a good existing idea can be kept. */
  uiYaml: string;
  widgetsJs: string;
  /** What the author asked for in their own words; empty for "just do it". */
  direction: string;
}

/** What the host answers: both files as TEXT, already checked. */
export interface AiOrganizeResult {
  uiYaml: string;
  widgetsJs: string;
  notes: string;
}

/** One line of the answer stream: progress while waiting, then exactly one `done` or `error`. */
export type AiOrganizeEvent =
  | { type: "status"; text: string }
  | { type: "done"; result: AiOrganizeResult }
  | { type: "error"; error: string; issues?: string[] };

/** The JSON the model is constrained to — snake_case, as the prompt names the fields. */
export const AI_RESULT_SCHEMA = {
  type: "object",
  properties: {
    ui_yaml: { type: "string" },
    widgets_js: { type: "string" },
    notes: { type: "string" },
  },
  required: ["ui_yaml", "widgets_js", "notes"],
  additionalProperties: false,
} as const;

/** The sounds module.yaml's own `rack:` declares, by symbol; none when it has no rack or does not parse. */
export function rackSymbols(moduleYaml: string): string[] {
  try {
    const symbols = (parse(moduleYaml) as { rack?: { symbols?: unknown } })
      ?.rack?.symbols;
    return symbols && typeof symbols === "object" ? Object.keys(symbols) : [];
  } catch {
    return [];
  }
}

/** Every bind a proposed panel may carry: the params, and on a rack module its taps — docs/aiOrganize.md. */
export function bindableNames(req: {
  params: readonly { name: string }[];
  moduleYaml: string;
}): string[] {
  const rack = rackSymbols(req.moduleYaml);
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
  const rack = rackSymbols(req.moduleYaml);
  return [
    `Module: ${req.module}`,
    "",
    "## module.yaml",
    "```yaml",
    req.moduleYaml.trim() || "# (empty)",
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
    "## Current ui.yaml",
    "```yaml",
    req.uiYaml.trim() || "# (none yet)",
    "```",
    "",
    "## Current widgets.js",
    "```js",
    req.widgetsJs.trim() || "// (none yet)",
    "```",
    "",
    direction
      ? `## What the author asks for\n${direction}`
      : "Design the panel.",
  ].join("\n");
}

/** The model's raw answer, read off its JSON text; null when it is not the promised shape. */
export function readAiAnswer(text: string): AiOrganizeResult | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r?.ui_yaml !== "string" || typeof r.widgets_js !== "string")
    return null;
  return {
    uiYaml: stripFence(r.ui_yaml),
    widgetsJs: stripFence(r.widgets_js),
    notes: typeof r.notes === "string" ? r.notes : "",
  };
}

// A model sometimes fences a file it was told to return bare; the fence would be YAML garbage.
const stripFence = (s: string): string =>
  s.replace(/^\s*```[a-z]*\n/, "").replace(/\n```\s*$/, "\n");

const span = (n?: number) => Math.max(1, n ?? 1);
const overlaps = (a: Widget, b: Widget) =>
  a.col < b.col + span(b.colSpan) &&
  b.col < a.col + span(a.colSpan) &&
  a.row < b.row + span(b.rowSpan) &&
  b.row < a.row + span(a.rowSpan);

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
      if (overlaps(ws[i][1], ws[j][1]))
        out.push(`${where}: \`${ws[i][0]}\` overlaps \`${ws[j][0]}\``);
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

/** Why a proposal must not land, as sentences the MODEL can act on; empty means it may. */
export function checkAiResult(
  res: AiOrganizeResult,
  bindNames: readonly string[],
): { ui: ModuleUI | null; issues: string[] } {
  let raw: unknown;
  try {
    raw = parse(res.uiYaml);
  } catch (e) {
    return {
      ui: null,
      issues: [`ui_yaml is not YAML: ${(e as Error).message}`],
    };
  }
  const parsed = UiFileSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ui: null,
      issues: parsed.error.issues.map(
        (i) => `ui_yaml ${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  const ui = parsed.data;
  const issues: string[] = [];
  const known = new Set(bindNames);
  const top = Object.entries(ui.widgets);
  // Panel-level widgets are drawn on EVERY page, so each page is checked together with them.
  const always = top.filter(([, w]) => w.type !== "tabs");
  const all: [string, Widget][] = [...top];
  issues.push(...layoutIssues(ui, "panel", top));
  for (const [tid, t] of top)
    for (const [page, ws] of Object.entries(t.pages ?? {})) {
      const inPage = Object.entries(ws);
      all.push(...inPage);
      issues.push(
        ...layoutIssues(ui, `${tid}/${page}`, [...always, ...inPage]),
      );
      for (const [id, w] of inPage)
        if (w.type === "tabs") issues.push(`\`${id}\`: tabs inside a page`);
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
    if (w.type === "lcdscreen" && !drawsFor(res.widgetsJs, id))
      issues.push(`lcdscreen \`${id}\` has no draw function in widgets_js`);
  }
  if (res.widgetsJs.trim()) {
    const err = scriptSyntaxError(res.widgetsJs);
    if (err) issues.push(`widgets_js does not compile: ${err}`);
  }
  return { ui, issues };
}
