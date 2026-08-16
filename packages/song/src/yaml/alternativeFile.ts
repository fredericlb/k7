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

// YAML 1.2 (so `5:1:1` stays a string) and no wrapping — the same options every module write
// takes, for the reason moduleFile gives.
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

/** What a module's file says its alternatives are called, in order. `["1"]` when it has none. */
export function alternativeNames(text: string): string[] {
  return alternativesOf(parseDocument(text, OPTS).toJS() ?? {}).map(
    (a) => a.name,
  );
}

/**
 * Switch which attribute set is on — ONE line rewritten, whatever the sets hold.
 *
 * That is the point of the shape: the sets stay where they are, so a switch is a one-line diff
 * in git and a one-line entry in the undo journal, and nothing can be lost half-way through
 * moving fields from one place to another.
 *
 * Back to the FIRST clears the key rather than writing `alternative: 1` — a module running its
 * own fields is a module that says nothing about alternatives, which is how every file that
 * never uses them stays byte-identical.
 */
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
  /**
   * This module is a LANE, so an empty set means `events: []`.
   *
   * Passed in rather than sniffed: whether a module is a lane is a question about its resolved
   * `extends` chain, and answering it needs the project's module vocabulary — which this file, a
   * pure document editor, deliberately does not have. `newModuleAlternative` asks `isTrack`.
   */
  blankEvents?: boolean;
}

/**
 * Add an attribute set and switch to it; answers the name it got.
 *
 * EMPTY is the default, and it is not the empty-looking thing it seems: an alternative states
 * only what it CHANGES, so an empty one is "the module as it is", and you then change the two
 * knobs you came to try. `copy: true` is the other half of the same wish — start from what is
 * playing rather than from what the file was authored with — and it takes the CURRENT set,
 * merged, so copying the second one copies the second one.
 *
 * The name comes back rather than being assumed by the caller, because an unnamed one is
 * numbered HERE, from the file: the only place that knows what is already taken.
 */
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
  // Named only when the author said one: an unnamed set is known by its position, and writing
  // "3" into the file would freeze a name that is meant to follow the order.
  if (name !== undefined) entry.name = name;
  if (copy) Object.assign(entry, copiedFields(doc));
  // A LANE's empty set is an empty ARRANGEMENT, not an inherited one. `states only what it
  // changes` cuts the wrong way here: a set that says nothing about `events:` inherits them, so a
  // new take would open holding the previous take's placements — and the point of a new take is
  // that it is empty. `events: []` says it outright, and a list being a scalar to the merge is
  // exactly what a lane's takes need. Not for `copy`, whose whole promise is what is playing.
  else if (blankEvents) entry.events = [];

  const node = doc.createNode(entry);
  const alts = doc.getIn(["alternatives"]);
  if (isSeq(alts)) alts.items.push(node);
  else doc.setIn(["alternatives"], doc.createNode([node]));
  doc.setIn(["alternative"], chosen);
  quoteTimecodes(doc);
  return { text: doc.toString(OUT), name: chosen };
}

/**
 * The fields a `copy` starts from: the set that is CURRENTLY on, as plain values.
 *
 * The module's own fields when the first is on, the selected entry's when it is not — and in
 * that second case only what that entry states, because that is what "a copy of this variant"
 * means. Copying the merged result would bake the module's own fields into the new entry, and
 * every later edit to them would then stop reaching it.
 */
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
  // The module's own, minus what says where it comes from and what the alternatives are. An
  // alternative may not re-parent its module, and it holds no alternatives of its own.
  const { extends: _e, alternatives: _a, alternative: _s, ...fields } = raw;
  return fields;
}
