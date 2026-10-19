// sliceSymbols.ts — a slice-rack file's symbols as the EDITOR knows them: where each one's `from`/`to` numbers and
// name sit in the buffer, the colour each slice wears everywhere (the dock's windows, the names in the text), and
// the CodeMirror extension that paints those names. The docked source waveform is THE slicer, one picture for every
// symbol, and its handles write through the same buffer a keystroke does (packages/ui-editor/docs/k7xTree.md).

import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { K7MapNode } from "@studio/k7x/ast";
import { parseTree } from "@studio/k7x/parse";
import { SERIES_COLORS, seriesColor } from "@studio/song-schema/seriesColors";
import { editK7xText } from "@studio/ui-editor/k7x/bufferEdit";
import { k7xTree, mapSpan, treeOf } from "@studio/ui-editor/k7x/tree";

export interface SliceSym {
  symbol: string;
  from: number; // seconds
  to: number;
  fromRange: [number, number]; // buffer positions of the `from` NUMBER
  toRange: [number, number];
  keyRange: [number, number]; // buffer positions of the symbol NAME (for the colour), quotes excluded
}

/** One colour per slice, by INDEX in the symbols map's own order, so 'the third slice is teal' is true in every view of a rack. */
export const SLICE_COLORS = SERIES_COLORS;
export const sliceColor = (i: number): string => seriesColor(i);

const round = (v: number) => Math.round(v * 10000) / 10000; // 0.1 ms

const entryOf = (map: K7MapNode | undefined, key: string) =>
  map?.entries.find((e) => e.key === key);
const mapOf = (map: K7MapNode | undefined, key: string) => {
  const v = entryOf(map, key)?.value;
  return v?.kind === "map" ? v : undefined;
};

/** The symbols of a parsed file: each one's window and the spans of its two numbers and its name. */
export function slicesOf(root: K7MapNode, text: string): SliceSym[] | null {
  const rack = mapOf(root, "rack");
  const type = entryOf(rack, "rack_type")?.value;
  if (type?.kind !== "scalar" || type.value !== "slice") return null;
  const symbols = mapOf(rack, "symbols");
  if (!symbols) return null;
  const out: SliceSym[] = [];
  for (const e of symbols.entries) {
    if (e.value.kind !== "map") continue;
    const from = entryOf(e.value, "from")?.value;
    const to = entryOf(e.value, "to")?.value;
    if (from?.kind !== "scalar" || to?.kind !== "scalar") continue;
    if (typeof from.value !== "number" || typeof to.value !== "number")
      continue;
    const quoted = /^["']/.test(text.slice(e.keyStart, e.keyStart + 1));
    out.push({
      symbol: e.key,
      from: from.value,
      to: to.value,
      fromRange: [from.start, from.end],
      toRange: [to.start, to.end],
      keyRange: quoted
        ? [e.keyStart + 1, e.keyEnd - 1]
        : [e.keyStart, e.keyEnd],
    });
  }
  return out.length ? out : null;
}

/** Each symbol's window and where its numbers and name sit; null for a file that is no slice rack or does not parse. */
export function scanSlices(text: string): SliceSym[] | null {
  // Every keystroke of a workspace file reaches here; a text naming no `rack_type` cannot be a slice rack.
  if (!text.includes("rack_type")) return null;
  try {
    return slicesOf(parseTree(text), text);
  } catch {
    return null;
  }
}

/** A rack's slice windows as the dock draws them, coloured on the same basis `sliceSymbolColors` indexes on. */
export function rackSliceRanges(
  symbols: readonly { symbol: string; from?: number; to?: number }[],
): { symbol: string; from: number; to: number; color: string }[] {
  return symbols
    .filter((s) => s.from != null && s.to != null)
    .map((s, i) => ({
      symbol: s.symbol,
      from: s.from as number,
      to: s.to as number,
      color: sliceColor(i),
    }));
}

/** Set one symbol's `from`/`to` in the buffer's text, the two numbers and nothing else; null means write nowhere. */
export function setSliceWindow(
  text: string,
  symbol: string,
  from: number,
  to: number,
): string | null {
  if (!scanSlices(text)?.some((s) => s.symbol === symbol)) return null;
  return editK7xText(text, (doc) => {
    doc.setIn(["rack", "symbols", symbol, "from"], round(from));
    doc.setIn(["rack", "symbols", symbol, "to"], round(to));
  });
}

/** The symbol names painted in their slice's colour — the link between a line of text and a window on the waveform. */
export function sliceSymbolColors(): Extension {
  const build = (state: EditorState): DecorationSet => {
    const tree = treeOf(state);
    const text = state.doc.toString();
    if (!tree.root || !text.includes("rack_type")) return Decoration.none;
    const syms = slicesOf(tree.root, tree.text);
    if (!syms) return Decoration.none;
    const b = new RangeSetBuilder<Decoration>();
    syms.forEach((s, i) => {
      const span = mapSpan(tree, s.keyRange[0], s.keyRange[1], text);
      if (!span) return;
      b.add(
        span.from,
        span.to,
        Decoration.mark({
          attributes: { style: `color:${sliceColor(i)};font-weight:600` },
        }),
      );
    });
    return b.finish();
  };
  return [
    k7xTree,
    StateField.define<DecorationSet>({
      create: build,
      update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
      provide: (f) => EditorView.decorations.from(f),
    }),
  ];
}
