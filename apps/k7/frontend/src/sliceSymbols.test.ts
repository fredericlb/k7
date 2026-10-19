import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  SLICE_COLORS,
  scanSlices,
  setSliceWindow,
  sliceColor,
  sliceSymbolColors,
} from "./sliceSymbols";

// A slice drag rewrites two NUMBERS of a k7x rack, so what is pinned is that the spans address them and the write touches nothing else.

/** Cut the doc at a reported range: what a colour would cover. */
const at = (doc: string, r: [number, number]) => doc.slice(r[0], r[1]);

const SLICE = `// a break, sliced
rack({
  rack_type: "slice",
  source: "break.wav",
  symbols: {
    BD: { note: 36, from: 0, to: 0.5 },
    SN: { note: 38, from: 0.5, to: 1.25 },
  },
})
`;

describe("scanSlices", () => {
  it("finds each symbol with its window", () => {
    const out = scanSlices(SLICE);
    expect(out?.map((s) => [s.symbol, s.from, s.to])).toEqual([
      ["BD", 0, 0.5],
      ["SN", 0.5, 1.25],
    ]);
  });

  it("reports ranges that address exactly the number, nothing around it", () => {
    const out = scanSlices(SLICE) ?? [];
    expect(at(SLICE, out[0].fromRange)).toBe("0");
    expect(at(SLICE, out[0].toRange)).toBe("0.5");
    expect(at(SLICE, out[1].fromRange)).toBe("0.5");
    expect(at(SLICE, out[1].toRange)).toBe("1.25");
  });

  it("reports the symbol NAME's range, quotes excluded", () => {
    const out = scanSlices(SLICE) ?? [];
    expect(at(SLICE, out[0].keyRange)).toBe("BD");
    const quoted = SLICE.replace("SN:", '"S N":');
    expect(at(quoted, (scanSlices(quoted) ?? [])[1].keyRange)).toBe("S N");
  });

  it("is null for a samples rack — those symbols name clips, not windows", () => {
    expect(
      scanSlices(
        'rack({ rack_type: "samples", symbols: { BD: { note: 36, clip: "kick" } } })\n',
      ),
    ).toBe(null);
  });

  it("is null for a module with no rack at all", () => {
    expect(scanSlices('plugin({ type: "internal", name: "4osc" })\n')).toBe(
      null,
    );
  });

  it("is null while the file doesn't parse, rather than guessing", () => {
    expect(
      scanSlices('rack({ rack_type: "slice", symbols: { BD: { from:'),
    ).toBe(null);
  });
});

describe("setSliceWindow — what the dock's drag commits", () => {
  it("rewrites exactly the two numbers, one line, and the comment stays", () => {
    const out = setSliceWindow(SLICE, "SN", 0.5374, 1) ?? "";
    expect(out).toContain("SN: { note: 38, from: 0.5374, to: 1 },");
    expect(out).toContain("BD: { note: 36, from: 0, to: 0.5 },");
    expect(out).toContain("// a break, sliced");
    const changed = out
      .split("\n")
      .filter((l, i) => l !== SLICE.split("\n")[i]);
    expect(changed).toHaveLength(1);
  });

  it("rounds to 0.1 ms, so a drag's float noise never lands in the file", () => {
    const out = setSliceWindow(SLICE, "BD", 0.123456789, 0.5) ?? "";
    expect(
      (parse(out).rack as { symbols: { BD: { from: number } } }).symbols.BD
        .from,
    ).toBe(0.1235);
  });

  it("answers null when the buffer holds no such symbol — a stray drag writes nowhere", () => {
    expect(setSliceWindow(SLICE, "HH", 0, 1)).toBe(null);
    expect(setSliceWindow('extends("x")\n', "BD", 0, 1)).toBe(null);
  });
});

describe("the colours in the text", () => {
  /** The text under every painted mark, in order. */
  const painted = (state: EditorState) => {
    const out: string[] = [];
    for (const d of state.facet(EditorView.decorations))
      if (typeof d !== "function")
        d.between(0, state.doc.length, (from, to) => {
          out.push(state.doc.sliceString(from, to));
        });
    return out;
  };

  it("paint each symbol name, and keep them while a line is half-typed", () => {
    let s = EditorState.create({
      doc: SLICE,
      extensions: [sliceSymbolColors()],
    });
    expect(painted(s)).toEqual(["BD", "SN"]);
    // Two characters at the top: the text stops parsing, and the names stay lit where they now are.
    s = s.update({ changes: { from: 0, insert: "x(" } }).state;
    expect(painted(s)).toEqual(["BD", "SN"]);
  });
});

describe("the palette", () => {
  it("gives neighbours different colours and cycles past its end", () => {
    expect(sliceColor(0)).not.toBe(sliceColor(1));
    expect(sliceColor(SLICE_COLORS.length)).toBe(sliceColor(0));
  });
});
