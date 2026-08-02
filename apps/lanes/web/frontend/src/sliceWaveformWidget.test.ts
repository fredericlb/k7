import { describe, expect, it } from "vitest";
import { scanSlices } from "./sliceWaveformWidget";

// Dragging a slice handle rewrites the `from`/`to` NUMBER in the document, by position. So
// the property worth pinning is not "it found a symbol" but "the range it reports actually
// addresses that number" — a range off by one silently eats a comma or a brace and leaves
// the author with a file that no longer parses.

/** Cut the doc at a reported range: what a drag would replace. */
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

  it("survives a `to` that is followed by more fields on the same line", () => {
    // The CUE reader's hazard: a field's value span ran to the closing brace, so `to`
    // would have grabbed "0.5, note: 36" whole. Here the parser bounds it.
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
    // The widget goes under the symbol's LAST line, not its first.
    expect(doc.slice(0, out[0].anchor)).toContain("to: 0.75");
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
    // Mid-keystroke. Returning a half-read set would place handles at stale offsets, and a
    // drag would then write into the wrong place.
    expect(
      scanSlices("rack:\n  rack_type: slice\n  symbols:\n    BD: { from:"),
    ).toBe(null);
  });

  it("skips a symbol whose window isn't a pair of numbers", () => {
    const doc =
      "rack:\n  rack_type: slice\n  source: b.wav\n  symbols:\n" +
      "    BD: { note: 36 }\n" +
      "    SN: { note: 38, from: 0, to: 1 }\n";
    expect(scanSlices(doc)?.map((s) => s.symbol)).toEqual(["SN"]);
  });
});
