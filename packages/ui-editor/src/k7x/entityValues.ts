// entityValues.ts (k7x) — every string value of a k7x buffer with the field it belongs to, and every key with its path.
// A value inside a list inherits the key above it, so `in(["melody", "pad"])` resolves like `track("melody")`.
// Shared by entityLinks and the tests; the offsets are the buffer's own, quotes excluded (docs/k7xTree.md).

import type { EditorState } from "@codemirror/state";
import { walk } from "@studio/k7x/ast";
import { mapSpan, treeOf } from "./tree";

export interface ValueToken {
  from: number;
  to: number;
  /** The key whose value this is, inherited through lists; null at the root. */
  field: string | null;
  /** Every key above it, outermost first, field included. */
  keyPath: string[];
  /** The string itself, as read. */
  value: string;
}

/** A map KEY that is itself an entity reference, what a graph's sections are made of. */
export interface KeyToken {
  from: number;
  to: number;
  /** The keys above it, outermost first; its own text is `key`. */
  keyPath: string[];
  key: string;
}

const keysOf = (path: readonly (string | number)[]): string[] =>
  path.filter((s): s is string => typeof s === "string");

/** The inner span of a quoted source: one character off each end when the text is quoted. */
const inner = (text: string, from: number, to: number) =>
  /^["'`]/.test(text.slice(from, from + 1)) && to - from >= 2
    ? { from: from + 1, to: to - 1 }
    : { from, to };

/** Every non-empty string value in the buffer, with its field and the keys above it. */
export function valueTokens(state: EditorState): ValueToken[] {
  const tree = treeOf(state);
  if (!tree.root) return [];
  const text = state.doc.toString();
  const out: ValueToken[] = [];
  walk(tree.root, (node, path) => {
    if (node.kind !== "scalar" || typeof node.value !== "string") return;
    if (!node.value) return;
    const span = mapSpan(tree, node.start, node.end, text);
    if (!span) return;
    const keys = keysOf(path);
    out.push({
      ...inner(text, span.from, span.to),
      field: keys.length ? keys[keys.length - 1] : null,
      keyPath: keys,
      value: node.value,
    });
  });
  return out;
}

/** Every map key in the buffer with the keys above it, so the caller decides per section which ones name something. */
export function keyTokens(state: EditorState): KeyToken[] {
  const tree = treeOf(state);
  if (!tree.root) return [];
  const text = state.doc.toString();
  const out: KeyToken[] = [];
  walk(tree.root, (_node, path, entry) => {
    if (!entry?.key) return;
    const span = mapSpan(tree, entry.keyStart, entry.keyEnd, text);
    if (!span) return;
    out.push({
      ...inner(text, span.from, span.to),
      keyPath: keysOf(path).slice(0, -1),
      key: entry.key,
    });
  });
  return out.sort((a, b) => a.from - b.from);
}
