import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { previewTriggers } from "./previewTriggers";

// The ▶ gutter: which lines of a k7x buffer can be auditioned.

const triggers = (doc: string) => {
  const state = EditorState.create({ doc });
  return previewTriggers(state)
    .map((t) => ({ line: state.doc.lineAt(t.pos).number, req: t.req }))
    .sort((a, b) => a.line - b.line);
};

describe("what earns a play button", () => {
  it("a clip's own source", () => {
    expect(triggers('source("kick.wav")\n')).toEqual([
      { line: 1, req: { kind: "source", source: "kick.wav" } },
    ]);
  });

  it("a samples rack's symbols, each playing its clip", () => {
    expect(
      triggers(
        [
          "rack({",
          '  rack_type: "samples",',
          "  symbols: {",
          '    BD: { note: 36, clip: "kick" },',
          '    SN: { note: 38, clip: "snare" },',
          "  },",
          "})",
          "",
        ].join("\n"),
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
        [
          "rack({",
          '  rack_type: "slice",',
          "  symbols: {",
          "    BD: { note: 36, from: 0, to: 0.5 },",
          "  },",
          '  source: "break.wav",',
          "})",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      {
        line: 4,
        req: { kind: "slice", source: "break.wav", from: 0, to: 0.5 },
      },
      { line: 6, req: { kind: "source", source: "break.wav" } },
    ]);
  });

  it("ignores a map that isn't a symbol", () => {
    // A widget has `col`/`row` numbers and no `note` — it must not offer a ▶.
    expect(
      triggers(
        'ui({ widgets: { w1: { type: "knob", col: 0, row: 0, min: 0, max: 1 } } })\n',
      ),
    ).toEqual([]);
  });

  it("ignores a slice symbol with no source anywhere", () => {
    expect(
      triggers("symbols({ BD: { note: 36, from: 0, to: 0.5 } })\n"),
    ).toEqual([]);
  });

  it("prefers a symbol's own clip over the rack's source", () => {
    const t = triggers(
      [
        "rack({",
        '  source: "break.wav",',
        '  symbols: { BD: { note: 36, clip: "kick", from: 0, to: 1 } },',
        "})",
        "",
      ].join("\n"),
    );
    expect(t.find((x) => x.line === 3)?.req).toEqual({
      kind: "clip",
      clip: "kick",
    });
  });
});
