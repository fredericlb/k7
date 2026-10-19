// alternativeFile.ts — switching and adding a module's attribute SETS, by editing its k7x
// document in place. Paired with ../alternatives.ts, which reads them. Every writer takes a
// scope (the whole file, or one chain item), so the comments and the key order survive.
// The readers take the module's DATA, not its text. See ../docs/alternatives.md.

import type { K7Scope } from "@studio/k7x/document";
import {
  alternativesOf,
  currentAlternative,
  pickAlternative,
} from "../alternatives";
import { AlternativeSchema } from "./moduleSchema";

type Data = Record<string, unknown>;

const dataOf = (doc: K7Scope): Data => (doc.toJS() ?? {}) as Data;

/** What a module says its alternatives are called, in order, read off its data. `["1"]` when it has none. */
export function alternativeNames(raw: Data): string[] {
  return alternativesOf(raw).map((a) => a.name);
}

/** Switch which attribute set is on — ONE value rewritten, and back to the FIRST clears the key. */
export function setAlternative(doc: K7Scope, name: string): void {
  const names = alternativeNames(dataOf(doc));
  const at = pickAlternative(names, name);
  if (names[at] !== name) throw new Error(`no alternative "${name}"`);
  if (at === 0) doc.deleteIn(["alternative"]);
  else doc.setIn(["alternative"], name);
}

/** What a switch to `name` does to the params, when that is ALL it does — null otherwise (docs/alternatives.md). */
export interface ParamsSwitch {
  /** The values to set: what the new set states, and the module's own for what only the old set stated. */
  params: Record<string, number>;
  /** Params only the old set stated and the module's own fields do not: their value is inherited, not here. */
  inherited: string[];
}

/** Read off the module's data alone, so a running engine can take the switch as values without a recompile. */
export function paramsSwitch(raw: Data, name: string): ParamsSwitch | null {
  const list = Array.isArray(raw.alternatives) ? raw.alternatives : [];
  const names = alternativeNames(raw);
  // The numeric params a set STATES, or null when it states anything else — the first states nothing.
  const stated = (at: number): Record<string, number> | null => {
    if (at === 0) return {};
    const { name: _n, params, ...rest } = (list[at - 1] ?? {}) as Data;
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
  const own = (raw.params ?? {}) as Data;
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

/** Where the set that is ON keeps its fields: the module's root for the first, its entry in `alternatives` otherwise. */
const setPath = (doc: K7Scope): (string | number)[] => {
  const at = currentAlternative(dataOf(doc));
  return at === 0 ? [] : ["alternatives", at - 1];
};

/** Set one param on the set that is ON, under `engines.<engine>` when the module runs one; `null` removes it (packages/song/docs/engines.md). */
export function setAlternativeParam(
  doc: K7Scope,
  name: string,
  value: number | string | null,
  engine?: string,
): void {
  const inSet = engine ? ["engines", engine, "params"] : ["params"];
  const key = [...setPath(doc), ...inSet, name];
  if (value === null) doc.deleteIn(key);
  else doc.setIn(key, value);
}

/** Remove every NUMBER the set that is ON states, under `engines.<engine>` when the module runs one — a file param stays. */
export function clearAlternativeParams(doc: K7Scope, engine?: string): void {
  const inSet = engine ? ["engines", engine, "params"] : ["params"];
  const path = [...setPath(doc), ...inSet];
  const params = doc.getIn(path);
  if (!params || typeof params !== "object" || Array.isArray(params)) return;
  const numbers = Object.keys(params).filter(
    (k) => typeof (params as Data)[k] === "number",
  );
  if (!numbers.length) return;
  for (const key of numbers) doc.deleteIn([...path, key]);
  if (!Object.keys(doc.getIn(path) as Data).length) doc.deleteIn(path);
}

/** Set one FIELD on the set that is ON — `engine:` being the one that needs it (packages/song/docs/engines.md). */
export function setAlternativeField(
  doc: K7Scope,
  field: string,
  value: string,
): void {
  doc.setIn([...setPath(doc), field], value);
}

export interface AddOptions {
  /** Start from the set that is ON rather than from nothing — see `copiedFields`. */
  copy?: boolean;
  /** This module is a LANE, so an empty set means `events: []` — passed in rather than sniffed. */
  blankEvents?: boolean;
}

/** Add an attribute set and switch to it, answering the name it got — EMPTY by default (docs/alternatives.md). */
export function addAlternative(
  doc: K7Scope,
  name?: string,
  { copy = false, blankEvents = false }: AddOptions = {},
): string {
  const raw = dataOf(doc);
  const names = alternativeNames(raw);
  const chosen = name ?? String(names.length + 1);
  if (names.includes(chosen))
    throw new Error(`this module already has an alternative "${chosen}"`);

  const entry: Data = {};
  // Named only when the author said one: an unnamed set is known by its position.
  if (name !== undefined) entry.name = name;
  if (copy) Object.assign(entry, copiedFields(raw));
  // A LANE's empty set is an empty ARRANGEMENT, since an inherited one would open holding the last take.
  else if (blankEvents) entry.events = [];

  if (Array.isArray(raw.alternatives)) doc.addIn(["alternatives"], entry);
  else doc.setIn(["alternatives"], [entry]);
  doc.setIn(["alternative"], chosen);
  return chosen;
}

/** The fields a `copy` starts from: only what the CURRENT set states, never the merged result. */
function copiedFields(raw: Data): Data {
  const at = currentAlternative(raw);
  if (at > 0) {
    const list = Array.isArray(raw.alternatives) ? raw.alternatives : [];
    const { name: _dropped, ...fields } = (list[at - 1] ?? {}) as Data;
    return fields;
  }
  // The module's own SETTINGS only: a chain step's `id`, `bypass`… are the item's, and a set refuses them.
  const { extends: _e, name: _n, ...fields } = raw;
  return Object.fromEntries(
    Object.entries(fields).filter(([k]) => k in AlternativeSchema.shape),
  );
}
