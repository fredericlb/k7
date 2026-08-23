import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { previewTriggers } from "./previewTriggers";

// The ▶ gutter: which lines can be auditioned, and the cases a hand-rolled scanner had to get right.

const triggers = (doc: string) => {
  const state = EditorState.create({ doc, extensions: [yaml()] });
  return previewTriggers(state)
    .map((t) => ({ line: state.doc.lineAt(t.pos).number, req: t.req }))
    .sort((a, b) => a.line - b.line);
};

describe("what earns a play button", () => {
  it("a clip's own source", () => {
    expect(triggers("source: kick.wav\n")).toEqual([
      { line: 1, req: { kind: "source", source: "kick.wav" } },
    ]);
  });

  it("a samples rack's symbols, each playing its clip", () => {
    expect(
      triggers(
        "rack:\n  rack_type: samples\n  symbols:\n    BD: { note: 36, clip: kick }\n    SN: { note: 38, clip: snare }\n",
      ),
    ).toEqual([
      { line: 4, req: { kind: "clip", clip: "kick" } },
      { line: 5, req: { kind: "clip", clip: "snare" } },
    ]);
  });

  it("a slice rack's symbols, against the source declared AFTER them", () => {
    // Why a second pass is needed: a slice symbol carries no source, and the rack's may sit below it.
    expect(
      triggers(
        "rack:\n  rack_type: slice\n  symbols:\n    BD: { note: 36, from: 0, to: 0.5 }\n  source: break.wav\n",
      ),
    ).toEqual([
      {
        line: 4,
        req: { kind: "slice", source: "break.wav", from: 0, to: 0.5 },
      },
      { line: 5, req: { kind: "source", source: "break.wav" } },
    ]);
  });

  it("ignores a mapping that isn't a symbol", () => {
    // A widget has `col`/`row` numbers and no `note` — it must not offer a ▶.
    expect(
      triggers(
        "ui:\n  widgets:\n    w1: { type: knob, col: 0, row: 0, min: 0, max: 1 }\n",
      ),
    ).toEqual([]);
  });

  it("ignores a slice symbol with no source anywhere", () => {
    // Nothing to play: offering the button would produce silence and no explanation.
    expect(
      triggers("symbols:\n    BD: { note: 36, from: 0, to: 0.5 }\n"),
    ).toEqual([]);
  });

  it("prefers a symbol's own clip over the rack's source", () => {
    const t = triggers(
      "rack:\n  source: break.wav\n  symbols:\n    BD: { note: 36, clip: kick, from: 0, to: 1 }\n",
    );
    expect(t.find((x) => x.line === 4)?.req).toEqual({
      kind: "clip",
      clip: "kick",
    });
  });
});
