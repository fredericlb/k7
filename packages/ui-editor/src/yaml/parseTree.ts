// parseTree.ts (yaml) — the YAML mode's lezer tree, parsed as far as the caller actually reads.
// A state is built parsing only its first 3000 characters under a 20 ms budget, and `syntaxTree` gives that back
// with no sign it is short, so a completion past the cut would go dark (docs/completion.md).

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Long enough that a real file always finishes; it returns the moment the parse does, so it costs nothing. */
const PARSE_MS = 5000;

/** The tree parsed through `upto`, the whole document by default, falling back to the budgeted tree on a timeout. */
export function parsedTree(
  state: EditorState,
  upto: number = state.doc.length,
): ReturnType<typeof syntaxTree> {
  return ensureSyntaxTree(state, upto, PARSE_MS) ?? syntaxTree(state);
}
