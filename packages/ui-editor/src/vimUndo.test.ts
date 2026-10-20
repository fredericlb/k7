// vimUndo.test.ts — a vim change headless: the transactions vim and the browser dispatch for `ciw`,
// typing and Esc, replayed on a real EditorState with the real history, boundaries sent by hand.

import { history, redo, undo, undoDepth } from "@codemirror/commands";
import {
  EditorState,
  type Extension,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { vimChangeBoundary, vimUndoSteps } from "./vimUndo";

/** An editor with the history, and a way to dispatch into it and to press Ctrl+Z / Ctrl+Y. */
function editor(doc: string, extra: Extension = []) {
  let state = EditorState.create({ doc, extensions: [history(), extra] });
  const run = (spec: TransactionSpec) => {
    state = state.update(spec).state;
  };
  const press = (cmd: typeof undo) =>
    cmd({ state, dispatch: (tr) => (state = tr.state) });
  return {
    run,
    press,
    get doc() {
      return state.doc.toString();
    },
    get depth() {
      return undoDepth(state);
    },
  };
}

const at = (ms: number) => Transaction.time.of(ms);
const boundary = { effects: vimChangeBoundary.of(null) };

/** `ciw` on 120, the cursor set for insert, then `132` typed a while later, then Esc. */
function changeTempo(e: ReturnType<typeof editor>): void {
  e.run(boundary);
  e.run({
    changes: { from: 7, to: 10 },
    userEvent: "input.type.compose.start",
    annotations: at(1000),
  });
  e.run({ selection: { anchor: 7 }, annotations: at(1001) });
  e.run({
    changes: { from: 7, insert: "132" },
    selection: { anchor: 10 },
    userEvent: "input.type",
    annotations: at(3000),
  });
  e.run(boundary);
}

describe("vimUndoSteps", () => {
  it("the history alone splits the change, and the first undo leaves half of it", () => {
    const e = editor("tempo: 120,");
    changeTempo(e);
    expect(e.depth).toBe(2);
    e.press(undo);
    expect(e.doc).toBe("tempo: ,");
  });

  it("makes one vim change one undo, and one redo", () => {
    const e = editor("tempo: 120,", vimUndoSteps());
    changeTempo(e);
    expect(e.doc).toBe("tempo: 132,");
    expect(e.depth).toBe(1);
    e.press(undo);
    expect(e.doc).toBe("tempo: 120,");
    e.press(redo);
    expect(e.doc).toBe("tempo: 132,");
  });

  it("keeps two changes two undos, however close together", () => {
    const e = editor("", vimUndoSteps());
    e.run(boundary);
    e.run({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
      annotations: at(1000),
    });
    e.run(boundary);
    e.run({
      changes: { from: 1, insert: "b" },
      userEvent: "input.type",
      annotations: at(1010),
    });
    expect(e.depth).toBe(2);
    e.press(undo);
    expect(e.doc).toBe("a");
  });

  it("does not fold typing after an undo into the change before it", () => {
    const e = editor("", vimUndoSteps());
    e.run({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
      annotations: at(1000),
    });
    e.run(boundary);
    e.run({
      changes: { from: 1, insert: "b" },
      userEvent: "input.type",
      annotations: at(2000),
    });
    e.press(undo);
    e.run({
      changes: { from: 1, insert: "c" },
      userEvent: "input.type",
      annotations: at(5000),
    });
    e.press(undo);
    expect(e.doc).toBe("a");
  });
});
