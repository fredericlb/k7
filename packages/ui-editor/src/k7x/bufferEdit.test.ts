import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { editChanges, editK7xText } from "./bufferEdit";

// A gesture's edit, made on the buffer's text, and the splices the editor dispatches for it instead of a whole replace.

const TEXT =
  "// the kit\nrack({ symbols: { BD: { note: 36, from: 0, to: 1 } } })\n";

describe("editK7xText", () => {
  it("edits by key path, the rest of the text kept", () => {
    const next = editK7xText(TEXT, (doc) =>
      doc.setIn(["rack", "symbols", "BD", "to"], 1.5),
    );
    expect(next).toBe(
      "// the kit\nrack({ symbols: { BD: { note: 36, from: 0, to: 1.5 } } })\n",
    );
  });

  it("is null when the text does not read, the edit refuses or it throws", () => {
    expect(editK7xText("rack({", () => {})).toBeNull();
    expect(editK7xText(TEXT, () => false)).toBeNull();
    expect(
      editK7xText(TEXT, () => {
        throw new Error("no");
      }),
    ).toBeNull();
  });
});

describe("editChanges", () => {
  it("gives the edit's own splices, which replay to the same text", () => {
    const next = editK7xText(TEXT, (doc) => {
      doc.setIn(["rack", "symbols", "BD", "from"], 0.25);
      doc.setIn(["rack", "symbols", "BD", "to"], 0.75);
    }) as string;
    const set = editChanges(TEXT, next);
    expect(set).not.toBeNull();
    const state = EditorState.create({ doc: TEXT });
    expect(state.update({ changes: set ?? [] }).state.doc.toString()).toBe(
      next,
    );
    // Two numbers changed, and nothing between them was rewritten.
    let touched = 0;
    set?.iterChanges((fromA, toA) => {
      touched += toA - fromA;
    });
    expect(touched).toBe(2);
  });

  it("is null for a pair no edit here made", () => {
    expect(editChanges(TEXT, `${TEXT}x`)).toBeNull();
  });
});
