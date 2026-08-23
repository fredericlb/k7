// entityValues.ts — every value in a YAML document, with the field it belongs to: each is a
// lezer node whose parent Pair carries the key, and a value inside a SEQUENCE inherits the
// key above it (so `in: [melody, pad]` resolves like `track: melody`). Shared by entityLinks
// and previewGutter, and tested on its own — a value's position is what they'd diverge on.

import type { EditorState } from "@codemirror/state";
// Both walks answer about the WHOLE document, so they ask for the whole document — see parseTree.ts.
import { parsedTree } from "./parseTree";

export interface ValueToken {
  from: number;
  to: number;
  /** The key whose value this is — inherited through sequences. Null at the root. */
  field: string | null;
  /** Every key above it, outermost first, field included — needed because a key is not always a FIELD NAME. */
  keyPath: string[];
  /** The text, with quotes stripped. */
  value: string;
}

/** A mapping KEY that is itself an entity reference — what chains.yaml is made of. */
export interface KeyToken {
  from: number;
  to: number;
  /** The keys above it, outermost first; its own text is `key`. */
  keyPath: string[];
  key: string;
}

const MAPPINGS = new Set(["BlockMapping", "FlowMapping"]);
const SEQUENCES = new Set(["BlockSequence", "FlowSequence"]);

/** Strip the quotes YAML may have put round a scalar. */
const unquote = (s: string): string =>
  (s.startsWith('"') && s.endsWith('"')) ||
  (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1)
    : s;

/** Every scalar VALUE in the document with its field, a key's own text skipped so `module: module` links one half. */
export function valueTokens(state: EditorState): ValueToken[] {
  const out: ValueToken[] = [];
  const tree = parsedTree(state);

  tree.iterate({
    enter(node) {
      if (node.name !== "Literal" && node.name !== "QuotedLiteral") return;
      // Is this the KEY half of its pair? Then it is not a value.
      const parent = node.node.parent;
      if (parent?.name === "Key") return;

      // Walk up for the field, skipping sequences: a value in a list belongs to the key that introduced the list.
      let field: string | null = null;
      for (let n = parent; n; n = n.parent) {
        if (SEQUENCES.has(n.name)) continue;
        if (n.name === "Pair") {
          const key = n.getChild("Key");
          field = key ? unquote(state.sliceDoc(key.from, key.to).trim()) : null;
          break;
        }
        // A mapping between the value and any pair means we have left the entry.
        if (MAPPINGS.has(n.name)) break;
      }

      const raw = state.sliceDoc(node.from, node.to);
      const value = unquote(raw);
      if (!value) return;
      // The offsets exclude the quotes, so a decoration underlines the text and not the punctuation round it.
      const pad = raw.length - value.length === 2 ? 1 : 0;
      out.push({
        from: node.from + pad,
        to: node.to - pad,
        field,
        keyPath: keysAbove(state, node.node),
        value,
      });
    },
  });
  return out;
}

/** Every mapping KEY with the keys above it, separate from valueTokens so the caller decides per section. */
export function keyTokens(state: EditorState): KeyToken[] {
  const out: KeyToken[] = [];
  parsedTree(state).iterate({
    enter(node) {
      if (node.name !== "Literal" && node.name !== "QuotedLiteral") return;
      const parent = node.node.parent;
      if (parent?.name !== "Key") return;
      const raw = state.sliceDoc(node.from, node.to);
      const key = unquote(raw);
      if (!key) return;
      const pad = raw.length - key.length === 2 ? 1 : 0;
      // Its OWN pair is dropped: a key's path is what contains it, and it is not inside itself.
      out.push({
        from: node.from + pad,
        to: node.to - pad,
        keyPath: keysAbove(state, node.node).slice(0, -1),
        key,
      });
    },
  });
  return out;
}

/** The keys of every Pair above `node`, outermost first — sequences don't interrupt the chain. */
function keysAbove(state: EditorState, node: { parent: unknown }): string[] {
  const path: string[] = [];
  for (
    let n = node.parent as {
      name: string;
      parent: unknown;
      getChild(t: string): { from: number; to: number } | null;
    } | null;
    n;
    n = n.parent as typeof n
  ) {
    if (n.name !== "Pair") continue;
    const key = n.getChild("Key");
    if (key) path.unshift(unquote(state.sliceDoc(key.from, key.to).trim()));
  }
  return path;
}
