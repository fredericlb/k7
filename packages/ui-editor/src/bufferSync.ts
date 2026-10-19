// bufferSync.ts — a k7x edit made on the host's text (k7x/bufferEdit.ts) reaches the CodeMirror view as its own splices,
// inside the undo history, before @uiw/react-codemirror would replace the whole document and lose the cursor.
// A reader would get wrong that it syncs every change: anything else, typing included, is still the wrapper's (docs/k7xTree.md).

import type { EditorView } from "@codemirror/view";
import { useLayoutEffect } from "react";
import { editChanges } from "./k7x/bufferEdit";

/** A layout effect, so it runs before the wrapper's own value effect and leaves that one nothing to do. */
export function useBufferSync(
  view: () => EditorView | null | undefined,
  content: string,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is read through a getter on purpose, `content` is the trigger.
  useLayoutEffect(() => {
    const v = view();
    if (!v) return;
    const changes = editChanges(v.state.doc.toString(), content);
    if (changes) v.dispatch({ changes });
  }, [content]);
}
