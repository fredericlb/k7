// tree.ts (k7x) — the buffer's k7x tree as a CodeMirror StateField: what the links, the ▶ gutter and the slice colours read.
// A reader would get wrong that it is always the buffer's: while the text does not parse it is the last tree that did,
// its offsets mapped through every edit since, so a half-typed line keeps the rest of the file lit (docs/k7xTree.md).

import {
  type ChangeDesc,
  type EditorState,
  MapMode,
  StateField,
} from "@codemirror/state";
import type { K7MapNode } from "@studio/k7x/ast";
import { parseTree } from "@studio/k7x/parse";

export interface K7xTree {
  root: K7MapNode | null;
  /** The text `root` was parsed from. */
  text: string;
  /** The edits made since `root` was parsed, null when it is the buffer's own tree. */
  since: ChangeDesc | null;
}

const parseOr = (text: string): K7MapNode | null => {
  try {
    return parseTree(text);
  } catch {
    return null;
  }
};

const fresh = (text: string): K7xTree => ({
  root: parseOr(text),
  text,
  since: null,
});

/** The field: reparsed on every change, the previous tree kept and mapped when the new text does not read. */
export const k7xTree = StateField.define<K7xTree>({
  create: (state) => fresh(state.doc.toString()),
  update(value, tr) {
    if (!tr.docChanged) return value;
    const next = fresh(tr.state.doc.toString());
    if (next.root || !value.root) return next;
    const desc = tr.changes.desc;
    return {
      ...value,
      since: value.since ? value.since.composeDesc(desc) : desc,
    };
  },
});

/** The tree of a state: the field's when the state has it, else a parse of its text, as a bare state in a test gets. */
export function treeOf(state: EditorState): K7xTree {
  return state.field(k7xTree, false) ?? fresh(state.doc.toString());
}

/** A span of the tree in `now`, the buffer as it is; null when the edits since have touched its text. */
export function mapSpan(
  tree: K7xTree,
  from: number,
  to: number,
  now: string,
): { from: number; to: number } | null {
  if (!tree.since) return { from, to };
  const a = tree.since.mapPos(from, 1, MapMode.TrackDel);
  const b = tree.since.mapPos(to, -1, MapMode.TrackDel);
  if (a === null || b === null || b <= a) return null;
  return now.slice(a, b) === tree.text.slice(from, to)
    ? { from: a, to: b }
    : null;
}
