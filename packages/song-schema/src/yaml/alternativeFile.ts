// alternativeFile.ts — switching and adding a module's attribute SETS, by editing its file in
// place. Paired with ../alternatives.ts, which reads them. Every write goes through the
// document rather than the text, so the comments and the key order survive — these files are
// hand-edited and they are in git. See ../docs/alternatives.md.

import { isMap, isSeq, parseDocument } from "yaml";
import {
  alternativesOf,
  currentAlternative,
  pickAlternative,
} from "../alternatives";
import { quoteTimecodes } from "./moduleFile";

// YAML 1.2 (so `5:1:1` stays a string) and no wrapping — the options every module write takes.
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

/** What a module's file says its alternatives are called, in order. `["1"]` when it has none. */
export function alternativeNames(text: string): string[] {
  return alternativesOf(parseDocument(text, OPTS).toJS() ?? {}).map(
    (a) => a.name,
  );
}

/** Switch which attribute set is on — ONE line rewritten, and back to the FIRST clears the key. */
export function setAlternative(text: string, name: string): string {
  const names = alternativeNames(text);
  const at = pickAlternative(names, name);
  if (names[at] !== name) throw new Error(`no alternative "${name}"`);
  const doc = parseDocument(text, OPTS);
  if (at === 0) doc.deleteIn(["alternative"]);
  else doc.setIn(["alternative"], name);
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

/** What a switch to `name` does to the params, when that is ALL it does — null otherwise (docs/alternatives.md). */
export interface ParamsSwitch {
  /** The values to set: what the new set states, and the module's own for what only the old set stated. */
  params: Record<string, number>;
  /** Params only the old set stated and the module's own fields do not: their value is inherited, not here. */
  inherited: string[];
}

/** Read off the file alone, so a running engine can take the switch as values without a recompile. */
export function paramsSwitch(text: string, name: string): ParamsSwitch | null {
  const raw = (parseDocument(text, OPTS).toJS() ?? {}) as Record<
    string,
    unknown
  >;
  const list = Array.isArray(raw.alternatives) ? raw.alternatives : [];
  const names = alternativesOf(raw).map((a) => a.name);
  // The numeric params a set STATES, or null when it states anything else — the first states nothing.
  const stated = (at: number): Record<string, number> | null => {
    if (at === 0) return {};
    const {
      name: _n,
      params,
      ...rest
    } = (list[at - 1] ?? {}) as Record<string, unknown>;
    if (Object.keys(rest).length) return null;
    if (params == null) return {};
    if (typeof params !== "object") return null;
    // A file-valued param (`nam`, `onnx`) is loaded when the plugin is BUILT, so it is not a value.
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v !== "number") return null;
      out[k] = v;
    }
    return out;
  };
  const from = stated(currentAlternative(raw));
  const to = stated(pickAlternative(names, name));
  if (!from || !to) return null;
  const own = (raw.params ?? {}) as Record<string, unknown>;
  const params: Record<string, number> = { ...to };
  const inherited: string[] = [];
  for (const k of Object.keys(from)) {
    if (k in to) continue;
    const v = own[k];
    if (typeof v === "number") params[k] = v;
    else if (v === undefined) inherited.push(k);
    else return null;
  }
  return { params, inherited };
}

/** Set one param on the set that is ON — the module's own for the first, else that entry (docs/alternatives.md). */
export function setAlternativeParam(
  text: string,
  name: string,
  value: number | string,
): string {
  const doc = parseDocument(text, OPTS);
  const at = currentAlternative(
    (doc.toJS() ?? {}) as { alternatives?: unknown; alternative?: unknown },
  );
  if (at === 0) doc.setIn(["params", name], value);
  else {
    // An empty set is written `- {}`; opened into block style, so its params read one per line.
    const entry = doc.getIn(["alternatives", at - 1]);
    if (isMap(entry)) entry.flow = false;
    doc.setIn(["alternatives", at - 1, "params", name], value);
    const params = doc.getIn(["alternatives", at - 1, "params"]);
    if (isMap(params)) params.flow = false;
  }
  quoteTimecodes(doc);
  return doc.toString(OUT);
}

export interface AddOptions {
  /** Start from the set that is ON rather than from nothing — see `copiedFields`. */
  copy?: boolean;
  /** This module is a LANE, so an empty set means `events: []` — passed in rather than sniffed. */
  blankEvents?: boolean;
}

/** Add an attribute set and switch to it, answering the name it got — EMPTY by default (docs/alternatives.md). */
export function addAlternative(
  text: string,
  name?: string,
  { copy = false, blankEvents = false }: AddOptions = {},
): { text: string; name: string } {
  const names = alternativeNames(text);
  const chosen = name ?? String(names.length + 1);
  if (names.includes(chosen))
    throw new Error(`this module already has an alternative "${chosen}"`);

  const doc = parseDocument(text, OPTS);
  const entry: Record<string, unknown> = {};
  // Named only when the author said one: an unnamed set is known by its position.
  if (name !== undefined) entry.name = name;
  if (copy) Object.assign(entry, copiedFields(doc));
  // A LANE's empty set is an empty ARRANGEMENT, since an inherited one would open holding the last take.
  else if (blankEvents) entry.events = [];

  const node = doc.createNode(entry);
  const alts = doc.getIn(["alternatives"]);
  if (isSeq(alts)) alts.items.push(node);
  else doc.setIn(["alternatives"], doc.createNode([node]));
  doc.setIn(["alternative"], chosen);
  quoteTimecodes(doc);
  return { text: doc.toString(OUT), name: chosen };
}

/** The fields a `copy` starts from: only what the CURRENT set states, never the merged result. */
function copiedFields(
  doc: ReturnType<typeof parseDocument>,
): Record<string, unknown> {
  const raw = (doc.toJS() ?? {}) as Record<string, unknown>;
  const at = currentAlternative(raw);
  if (at > 0) {
    const list = Array.isArray(raw.alternatives) ? raw.alternatives : [];
    const { name: _dropped, ...fields } = (list[at - 1] ?? {}) as Record<
      string,
      unknown
    >;
    return fields;
  }
  // The module's own, minus what says where it comes from and what the alternatives are.
  const { extends: _e, alternatives: _a, alternative: _s, ...fields } = raw;
  return fields;
}
