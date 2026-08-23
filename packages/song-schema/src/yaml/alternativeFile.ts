// alternativeFile.ts — switching and adding a module's attribute SETS, by editing its file in
// place. Paired with ../alternatives.ts, which reads them. Every write goes through the
// document rather than the text, so the comments and the key order survive — these files are
// hand-edited and they are in git. See ../docs/alternatives.md.

import { isSeq, parseDocument } from "yaml";
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
