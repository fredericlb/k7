// keyPath.ts — where the cursor sits, in terms of the document's keys: the lezer tree's
// shape IS the answer (every mapping entry is a Pair with a Key child). The one thing it
// cannot say is whether a fresh indented line is a key or a value position — the innermost
// pair is still the parent's — so the text typed so far answers that (see keyPosition).

import type { EditorState } from "@codemirror/state";
import { parsedTree } from "./parseTree";

export interface CursorContext {
  /** The keys enclosing the cursor's own mapping, outermost first — while typing `w1` it is the mapping that HOLDS w1. */
  path: string[];
  /** Is the cursor where a field NAME goes, rather than a value? */
  inKey: boolean;
  /** The field whose value the cursor is filling, when it is filling one. */
  valueOf: string | null;
  /** Is the cursor on the `- ` item of a block sequence, which is genuinely BOTH? See docs/completion.md. */
  inSeqItem: boolean;
}

const MAPPINGS = new Set(["BlockMapping", "FlowMapping"]);

/** Resolve the cursor's position in key terms; `pos` is a document offset, normally the head of the selection. */
export function cursorContext(state: EditorState, pos: number): CursorContext {
  // Parsed through the caret, or completion stops being offered partway down a long file (see parseTree.ts).
  const tree = parsedTree(state, pos);
  // -1 biases to the node ENDING at pos: after `type:` we want that pair, not whatever begins next.
  const node = tree.resolveInner(pos, -1);

  // The mapping the cursor is IN, then every Pair above. That boundary tells "inside w1's map" from "naming w1".
  const path: string[] = [];
  let ownField: string | null = null;
  let insideMapping = false;
  for (
    let n: typeof node | null = node;
    n;
    n = n.parent as typeof node | null
  ) {
    if (MAPPINGS.has(n.name)) {
      insideMapping = true;
      continue;
    }
    if (n.name !== "Pair") continue;
    const keyNode = (
      n as unknown as {
        getChild(k: string): { from: number; to: number } | null;
      }
    ).getChild("Key");
    const key = keyNode
      ? state.sliceDoc(keyNode.from, keyNode.to).trim()
      : null;
    if (!insideMapping) {
      // A Pair reached before any mapping names the field being filled, unless the cursor is indented past that key.
      if (nestedUnder(state, pos, n.from)) {
        if (key !== null) path.push(key);
        insideMapping = true;
        continue;
      }
      ownField ??= key;
      continue;
    }
    if (key !== null) path.push(key);
  }
  path.reverse();

  const { inKey, inSeqItem } = linePosition(state, pos);
  return { path, inKey, valueOf: inKey ? null : ownField, inSeqItem };
}

/** Is the cursor's line indented deeper than the line `keyFrom` sits on? */
function nestedUnder(
  state: EditorState,
  pos: number,
  keyFrom: number,
): boolean {
  const indentOf = (offset: number): number => {
    const line = state.doc.lineAt(offset);
    return /^\s*/.exec(line.text)?.[0].length ?? 0;
  };
  const here = state.doc.lineAt(pos);
  const key = state.doc.lineAt(keyFrom);
  return here.number > key.number && indentOf(pos) > indentOf(keyFrom);
}

/** What the cursor's own LINE says: a mapping entry is a key until its colon, read from the last structural break. */
function linePosition(
  state: EditorState,
  pos: number,
): { inKey: boolean; inSeqItem: boolean } {
  const line = state.doc.lineAt(pos);
  let fragment = state.sliceDoc(line.from, pos);
  const brk = Math.max(fragment.lastIndexOf("{"), fragment.lastIndexOf(","));
  let marker = false;
  if (brk >= 0) fragment = fragment.slice(brk + 1);
  else {
    const bare = fragment.replace(/^\s*-\s*/, "");
    marker = bare !== fragment;
    fragment = bare;
  }
  const inKey = !fragment.includes(":");
  // A `- ` that HAS its colon is an ordinary mapping entry; only the undecided one is both.
  return { inKey, inSeqItem: marker && inKey };
}
