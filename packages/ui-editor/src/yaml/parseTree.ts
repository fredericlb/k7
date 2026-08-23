// parseTree.ts — the syntax tree, parsed as far as the caller actually reads.
//
// Building an EditorState parses only the first `Work.InitViewport` (3000) characters, under a 20 ms budget,
// and keeps whatever it got (`@codemirror/language`'s LanguageState.init). `syntaxTree` hands that back with no
// indication it is short — so a walk over a 8.5 kB chains.yaml finds a third of the file and every link, gutter
// and completion past the cut silently goes dark. The same budget is why a loaded CI runner can return an EMPTY
// tree for a two-line document: the first parse in a cold worker builds the parse tables, and 20 ms need not
// cover that. A live EditorView eventually catches up in the background; a bare state never does.

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
