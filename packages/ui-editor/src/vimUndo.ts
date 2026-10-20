// vimUndo.ts — one vim change is ONE undo event: the operator's edit and everything typed until insert
// mode is left, as vim's `u` counts it, for Ctrl+Z, Ctrl+Y and `u` alike (docs/vimUndo.md).
// A reader would get wrong that it edits the history: it only labels transactions, and CodeMirror's
// own history joins them.

import { isolateHistory } from "@codemirror/commands";
import {
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";

/** A new vim command begins: the next edit opens an undo event of its own. */
export const vimChangeBoundary = StateEffect.define<null>();

/** The person's own edit, as the history would record it — typing, a deletion, a vim operator. */
function personal(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    tr.annotation(Transaction.addToHistory) !== false &&
    !tr.isUserEvent("undo") &&
    !tr.isUserEvent("redo") &&
    (tr.isUserEvent("input") || tr.isUserEvent("delete"))
  );
}

/** How many edits the current vim change has made so far. */
const editsInChange = StateField.define<number>({
  create: () => 0,
  update(n, tr) {
    if (tr.effects.some((e) => e.is(vimChangeBoundary))) return 0;
    // After an undo the event on top is an older change, which the next edit must not join.
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return 0;
    return personal(tr) ? n + 1 : n;
  },
});

// The history joins `input.type.compose` into the event before it unconditionally — no delay, no cursor rule.
const JOIN = "input.type.compose";

const joinEdits = EditorState.transactionFilter.of((tr) => {
  if (!personal(tr)) return tr;
  const label: TransactionSpec =
    tr.startState.field(editsInChange, false) === 0
      ? {
          annotations: [
            isolateHistory.of("before"),
            // …and a first edit must not join the PREVIOUS change through that same rule.
            ...(tr.annotation(Transaction.userEvent) === JOIN
              ? [Transaction.userEvent.of(`${JOIN}.start`)]
              : []),
          ],
        }
      : { userEvent: JOIN };
  // First in the list, because the first annotation of a type is the one a transaction answers.
  return [label, tr];
});

/** Closes a change on vim's own signals: each normal-mode command, and leaving insert mode. */
const vimSignals = ViewPlugin.define((view: EditorView) => {
  let cm: ReturnType<typeof getCM> = null;
  let inserting = false;
  const close = () => {
    if (!view.state.field(editsInChange, false)) return;
    const spec = { effects: vimChangeBoundary.of(null) };
    // A signal raised inside an update cannot dispatch, so it closes the change right after.
    try {
      view.dispatch(spec);
    } catch {
      queueMicrotask(() => view.dispatch(spec));
    }
  };
  const onMode = (e: { mode: string }) => {
    const was = inserting;
    inserting = e.mode === "insert" || e.mode === "replace";
    if (was && !inserting) close();
  };
  const onDone = () => {
    if (!inserting) close();
  };
  const attach = () => {
    cm = getCM(view);
    cm?.on("vim-mode-change", onMode);
    cm?.on("vim-command-done", onDone);
  };
  attach();
  return {
    update() {
      if (!cm) attach();
    },
    destroy() {
      cm?.off("vim-mode-change", onMode);
      cm?.off("vim-command-done", onDone);
    },
  };
});

/** Beside `vim()`: makes each vim change a single undo event. */
export function vimUndoSteps(): Extension {
  return [editsInChange, joinEdits, vimSignals];
}
