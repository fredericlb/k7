// aiAnswer.ts — the JSON the model answers AI organize with, and its turn into the `ui.k7x` text that lands in a buffer.
// A reader would get wrong that the model writes k7x: it writes the panel as JSON data, and panelText.ts prints it.
// Widgets come as LISTS carrying their id, since a structured output allows no map with keys of the model's choosing.

import {
  WAVEFORM_SOURCES,
  WIDGET_TYPES,
} from "@studio/song-schema/yaml/moduleSchema";
import { panelFileText } from "./panelText";

/** What the host answers: both files as TEXT, already checked. */
export interface AiOrganizeResult {
  uiText: string;
  widgetsJs: string;
  notes: string;
}

/** The answer as read, with what turning it into a panel could not keep: a widget id twice in one list. */
export interface AiAnswer extends AiOrganizeResult {
  issues?: string[];
}

const WIDGET = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: [...WIDGET_TYPES] },
    col: { type: "integer" },
    row: { type: "integer" },
    colSpan: { type: "integer" },
    rowSpan: { type: "integer" },
    label: { type: "string" },
    text: { type: "string" },
    bind: { type: "string" },
    pair: { type: "string" },
    min: { type: "number" },
    max: { type: "number" },
    step: { type: "number" },
    curve: { type: "string", enum: ["lin", "log"] },
    hidden: { type: "boolean" },
    source: { type: "string", enum: [...WAVEFORM_SOURCES] },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, value: { type: "number" } },
        required: ["label", "value"],
        additionalProperties: false,
      },
    },
    library: { type: "string" },
    color: { type: "string" },
    invert: { type: "boolean" },
  },
  required: ["id", "type", "col", "row"],
  additionalProperties: false,
} as const;

const WIDGETS = { type: "array", items: WIDGET } as const;

const TABS = {
  type: "array",
  items: {
    type: "object",
    properties: { name: { type: "string" }, widgets: WIDGETS },
    required: ["name", "widgets"],
    additionalProperties: false,
  },
} as const;

const LAYOUT = {
  cols: { type: "integer" },
  rows: { type: "integer" },
  widgets: WIDGETS,
  tabs: TABS,
} as const;

/** The JSON the model is constrained to — snake_case at the top, as the prompt names the fields. */
export const AI_RESULT_SCHEMA = {
  type: "object",
  properties: {
    header: { type: "string" },
    panel: {
      type: "object",
      properties: {
        ...LAYOUT,
        vertical: {
          type: "object",
          properties: LAYOUT,
          required: ["cols", "rows", "widgets"],
          additionalProperties: false,
        },
      },
      required: ["cols", "rows", "widgets"],
      additionalProperties: false,
    },
    widgets_js: { type: "string" },
    notes: { type: "string" },
  },
  required: ["header", "panel", "widgets_js", "notes"],
  additionalProperties: false,
} as const;

type Data = Record<string, unknown>;

const isRecord = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A widget list as the id-keyed map the file holds; an id met twice is reported and its later widget dropped. */
function widgetMap(list: unknown, where: string, issues: string[]): unknown {
  if (!Array.isArray(list)) return list;
  const out: Data = {};
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== "string") return list;
    const { id, ...widget } = item;
    if (Object.hasOwn(out, id))
      issues.push(`${where}: widget id \`${id}\` is used twice`);
    else out[id] = widget;
  }
  return out;
}

/** A layout with its widget lists made maps, its tabs' and its vertical twin's too. */
function layoutData(raw: Data, where: string, issues: string[]): Data {
  const out: Data = {};
  for (const key of ["cols", "rows"])
    if (raw[key] !== undefined) out[key] = raw[key];
  if (raw.widgets !== undefined)
    out.widgets = widgetMap(raw.widgets, where, issues);
  if (Array.isArray(raw.tabs) && raw.tabs.length)
    out.tabs = raw.tabs.map((t) =>
      isRecord(t)
        ? {
            name: t.name,
            widgets: widgetMap(t.widgets, `tab ${t.name}`, issues),
          }
        : t,
    );
  if (isRecord(raw.vertical))
    out.vertical = layoutData(raw.vertical, "vertical", issues);
  return out;
}

// A model sometimes fences a file it was told to return bare; the fence would not compile.
const stripFence = (s: string): string =>
  s.replace(/^\s*```[a-z]*\n/, "").replace(/\n```\s*$/, "\n");

/** The model's raw answer, read off its JSON text and printed as `ui.k7x`; null when it is not the promised shape. */
export function readAiAnswer(text: string): AiAnswer | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.panel)) return null;
  if (typeof raw.widgets_js !== "string") return null;
  const issues: string[] = [];
  const panel = layoutData(raw.panel, "panel", issues);
  const header = typeof raw.header === "string" ? raw.header.trim() : "";
  let uiText: string;
  try {
    uiText = panelFileText(panel, header ? [header] : []);
  } catch {
    return null;
  }
  return {
    uiText,
    widgetsJs: stripFence(raw.widgets_js),
    notes: typeof raw.notes === "string" ? raw.notes : "",
    ...(issues.length ? { issues } : {}),
  };
}
