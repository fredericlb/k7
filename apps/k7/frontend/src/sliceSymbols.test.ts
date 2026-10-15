import { describe, expect, it } from "vitest";
import {
  SLICE_COLORS,
  scanSlices,
  setSliceWindow,
  sliceColor,
} from "./sliceSymbols";

// Dragging a slice handle rewrites a NUMBER by position, so what is pinned is that the range addresses that number — one off eats a brace.

/** Cut the doc at a reported range: what a drag would replace, or a colour would cover. */
const at = (doc: string, r: [number, number]) => doc.slice(r[0], r[1]);

const SLICE = `# a break, sliced
rack:
  rack_type: slice
  source: break.wav
  symbols:
    BD: { note: 36, from: 0, to: 0.5 }
    SN: { note: 38, from: 0.5, to: 1.25 }
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
    const out = scanSlices(SLICE)!;
    expect(at(SLICE, out[0].fromRange)).toBe("0");
    expect(at(SLICE, out[0].toRange)).toBe("0.5");
    expect(at(SLICE, out[1].fromRange)).toBe("0.5");
    expect(at(SLICE, out[1].toRange)).toBe("1.25");
  });

  it("reports the symbol NAME's range — what the colour is painted over", () => {
    const out = scanSlices(SLICE)!;
    expect(at(SLICE, out[0].keyRange)).toBe("BD");
    expect(at(SLICE, out[1].keyRange)).toBe("SN");
  });

  it("survives a `to` that is followed by more fields on the same line", () => {
    // The CUE reader's hazard: a field's value span ran to the closing brace, where here the parser bounds it.
    const doc =
      "rack:\n  rack_type: slice\n  source: b.wav\n  symbols:\n    BD: { from: 0, to: 0.5, note: 36 }\n";
    const out = scanSlices(doc)!;
    expect(at(doc, out[0].toRange)).toBe("0.5");
  });

  it("reads a symbol written across several lines too", () => {
    const doc = `rack:
  rack_type: slice
  source: b.wav
  symbols:
    BD:
      note: 36
      from: 0.25
      to: 0.75
`;
    const out = scanSlices(doc)!;
    expect([out[0].from, out[0].to]).toEqual([0.25, 0.75]);
    expect(at(doc, out[0].fromRange)).toBe("0.25");
    expect(at(doc, out[0].keyRange)).toBe("BD");
  });

  it("is null for a samples rack — those symbols name clips, not windows", () => {
    expect(
      scanSlices(
        "rack:\n  rack_type: samples\n  symbols:\n    BD: { note: 36, clip: kick }\n",
      ),
    ).toBe(null);
  });

  it("is null for a module with no rack at all", () => {
    expect(scanSlices("plugin:\n  type: internal\n  name: 4osc\n")).toBe(null);
  });

  it("is null while the file doesn't parse, rather than guessing", () => {
    // Mid-keystroke. Returning a half-read set would place a drag's write at stale offsets.
    expect(
      scanSlices("rack:\n  rack_type: slice\n  symbols:\n    BD: { from:"),
    ).toBe(null);
  });
});

describe("setSliceWindow — what the dock's drag commits", () => {
  it("rewrites exactly the two numbers, and the file still parses", () => {
    const out = setSliceWindow(SLICE, "SN", 0.5374, 1)!;
    expect(out).toContain("SN: { note: 38, from: 0.5374, to: 1 }");
    expect(out).toContain("BD: { note: 36, from: 0, to: 0.5 }"); // untouched
    expect(scanSlices(out)?.[1]).toMatchObject({ from: 0.5374, to: 1 });
  });

  it("rounds to 0.1 ms, so a drag's float noise never lands in the file", () => {
    const out = setSliceWindow(SLICE, "BD", 0.123456789, 0.5)!;
    expect(out).toContain("from: 0.1235");
  });

  it("answers null when the buffer holds no such symbol — a stray drag writes nowhere", () => {
    expect(setSliceWindow(SLICE, "HH", 0, 1)).toBe(null);
    expect(setSliceWindow("extends: x\n", "BD", 0, 1)).toBe(null);
  });
});

describe("the palette", () => {
  it("gives neighbours different colours and cycles past its end", () => {
    expect(sliceColor(0)).not.toBe(sliceColor(1));
    expect(sliceColor(SLICE_COLORS.length)).toBe(sliceColor(0));
  });
});
