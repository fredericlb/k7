// moduleFile.ts — reading and EDITING a module file, as YAML. Paired with
// moduleSchema.ts. The point isn't parsing, it's WRITING without reflowing the
// document or dropping comments — l8 edits these constantly and they're in git.

import {
  type Document,
  isMap,
  LineCounter,
  parseDocument,
  Scalar,
  visit,
  type YAMLMap,
} from "yaml";
import { type Module, ModuleSchema } from "./moduleSchema";
import { TIMECODE, TIMECODE_KEYS } from "./placementSchema";

/** A problem in a module file, with where it is — line/column when the file says so. */
export interface ModuleIssue {
  path: string; // "ui.widgets.w2.library" — dotted key path
  message: string;
  line?: number;
  col?: number;
}

export interface ParsedModule {
  /** The validated module, with defaults applied. Null when `issues` is non-empty. */
  value: Module | null;
  issues: ModuleIssue[];
}

// YAML 1.2, forced: a file may declare 1.1, whose sexagesimals and true-like scalars are this app's vocabulary.
const PARSE_OPTIONS = { version: "1.2" as const, strict: false };

/** Where `path` sits in the document, for an error that points at the line. Exported for
 *  validate.ts, which asks the same question of the kinds that have no parser of their own. */
export function locate(
  doc: Document.Parsed,
  lines: LineCounter,
  path: (string | number)[],
): { line?: number; col?: number } {
  if (!path.length) return {};
  let node: unknown = doc.contents; // walk to the deepest node that exists — point at the map that lacks the key, not at nothing
  let best: unknown = node;
  for (const key of path) {
    if (!isMap(node)) break;
    const next = (node as YAMLMap).get(key, true);
    if (next === undefined) break;
    best = next;
    node = next;
  }
  const range = (best as Scalar)?.range;
  if (!range) return {};
  const pos = lines.linePos(range[0]);
  return { line: pos.line, col: pos.col };
}

/** Parse + validate one module file. */
export function parseModule(text: string): ParsedModule {
  const lines = new LineCounter(); // turns a byte offset into a line/column, so a parse error isn't one you have to hunt for
  const doc = parseDocument(text, { ...PARSE_OPTIONS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS({ maxAliasCount: 100 }) ?? {}; // an empty file is an empty module, not an error — a scaffolded one starts blank
  const result = ModuleSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      // An unknown key is reported against its CONTAINING object, so rebuild the path to give the key a line number.
      const keys = (issue as { keys?: string[] }).keys;
      const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
      issues.push({
        path: path.map(String).join("."),
        message: issue.message,
        ...locate(doc, lines, path as (string | number)[]),
      });
    }
    return { value: null, issues };
  }
  // The default — applied on the way OUT, never into the file.
  const value = result.data;
  if (value.type === undefined && value.io === undefined) value.type = "plugin";
  return { value, issues: [] };
}

/** Format an issue the way the old compiler did, so a reader recognises it. */
export const formatIssue = (rel: string, i: ModuleIssue): string =>
  `${rel}${i.line ? `:${i.line}${i.col ? `:${i.col}` : ""}` : ""}: ` +
  `${i.path ? `${i.path}: ` : ""}${i.message}`;

// YAML 1.1 reads these as booleans. We parse 1.2, where they are plain strings — but the file is read by
// people and by other tools, and `monitor: on` meaning `true` somewhere else is the kind of thing nobody
// finds twice. So a value that LOOKS like a keyword is written quoted, exactly as the scaffold writes it.
const YAML11_BOOLEANS = new Set([
  "on",
  "off",
  "yes",
  "no",
  "true",
  "false",
  "y",
  "n",
]);
const quoteIfKeyword = (
  doc: ReturnType<typeof parseDocument>,
  value: unknown,
): unknown => {
  if (typeof value !== "string" || !YAML11_BOOLEANS.has(value.toLowerCase()))
    return value;
  const node = doc.createNode(value) as { type?: string };
  node.type = "QUOTE_DOUBLE";
  return node;
};

/**
 * Quote every timecode in the document, wherever it sits — applied after every write rather than
 * at each call site, so nothing can forget.
 *
 * It guards MODULE files now, not just lanes, because a lane IS a module: `nodes/melody.yaml`
 * carries `events:` with a `start: "25:1"` in it, and unquoted that is a valid YAML 1.1 sexagesimal
 * — bar 25 reads back as beat 1501, silently, in a file nothing else would complain about.
 */
export function quoteTimecodes(doc: ReturnType<typeof parseDocument>): void {
  visit(doc, {
    Pair(_, pair) {
      // A key set through the document API arrives as a bare string, not a Scalar — reading only `.value` there
      // skipped the pair entirely and let a freshly written `to: 3:1` out unquoted, which is the one bug this
      // function exists to prevent.
      const raw = pair.key as Scalar | string;
      const key = typeof raw === "string" ? raw : raw?.value;
      if (typeof key !== "string" || !TIMECODE_KEYS.has(key)) return;
      const quoted = (v: unknown): Scalar | undefined => {
        // A bare string has nowhere to carry the quoting style, so it is promoted to a Scalar that does.
        if (typeof v === "string" && TIMECODE.test(v)) {
          const s = new Scalar(v);
          s.type = Scalar.QUOTE_DOUBLE;
          return s;
        }
        const s = v as Scalar;
        if (s && typeof s.value === "string" && TIMECODE.test(s.value))
          s.type = Scalar.QUOTE_DOUBLE;
        return undefined;
      };
      const value = pair.value as { items?: unknown[] };
      // Scalars, but a sequence of them is marked item by item rather than skipped.
      if (Array.isArray(value?.items))
        value.items = value.items.map((i) => quoted(i) ?? i);
      else pair.value = quoted(value) ?? pair.value;
    },
  });
}

/** Set one value in the file, leaving every other byte alone (comments, key order, layout survive) — a knob drag is a one-line diff. `null` removes the key. */
/**
 * Set a list of numbers in the file, written INLINE — `channel: [ 1, 2 ]`.
 *
 * Its own function rather than a branch in `setModuleValue`, because the difference is only how it
 * LOOKS and that one takes `unknown`: teaching it to reflow every array would restyle lists written
 * by callers that never asked. A two-element block sequence costs three lines to say one thing, and
 * these are files people edit as text first.
 */
export function setModuleList(
  text: string,
  path: (string | number)[],
  values: number[],
): string {
  if (!path.length) throw new Error("setModuleList: empty path");
  const doc = parseDocument(text, PARSE_OPTIONS);
  const node = doc.createNode(values);
  // On the NODE, not at stringify time: only this sequence should be inline, and a document-wide
  // setting would reflow every other list in the file.
  (node as { flow?: boolean }).flow = true;
  doc.setIn(path, node);
  return String(doc);
}

export function setModuleValue(
  text: string,
  path: (string | number)[],
  value: unknown,
): string {
  if (!path.length) throw new Error("setModuleValue: empty path");
  const doc = parseDocument(text, PARSE_OPTIONS);
  if (value === null) doc.deleteIn(path);
  else doc.setIn(path, quoteIfKeyword(doc, value));
  quoteTimecodes(doc);
  return String(doc);
}
