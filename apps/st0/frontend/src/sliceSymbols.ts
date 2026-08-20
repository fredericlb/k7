// sliceSymbols.ts — a slice-rack file's symbols as the EDITOR knows them: where each one's
// `from`/`to` numbers sit in the doc (for the dock's drag to rewrite), the colour each slice
// wears everywhere (the dock's windows, the symbol names in the text), and the CodeMirror
// extension that paints those names. The inline per-symbol waveforms this file's predecessor
// drew are gone — the docked source waveform is THE slicer now, one picture instead of one per
// symbol, and its handles write through the same buffer a keystroke does.

import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { isMap, isScalar, parseDocument } from "yaml";

export interface SliceSym {
  symbol: string;
  from: number; // seconds
  to: number;
  fromRange: [number, number]; // doc positions of the `from` NUMBER (for the edit)
  toRange: [number, number];
  keyRange: [number, number]; // doc positions of the symbol NAME (for the colour)
}

/**
 * One colour per slice, shared by every view of a slice rack: the docked waveform's windows and
 * the symbol names in the text. By INDEX in the symbols map's own order, which every reader
 * walks the same way (the hints fold and this scan both preserve insertion order), so "the
 * third slice is violet" is true everywhere at once. Eight hues, cycled — a break sliced finer
 * than eight repeats them, which still separates every neighbour.
 */
export const SLICE_COLORS = [
  "#f472b6", // pink
  "#38bdf8", // sky
  "#a3e635", // lime
  "#fb923c", // orange
  "#a78bfa", // violet
  "#2dd4bf", // teal
  "#fb7185", // rose
  "#818cf8", // indigo
] as const;
export const sliceColor = (i: number): string =>
  SLICE_COLORS[
    ((i % SLICE_COLORS.length) + SLICE_COLORS.length) % SLICE_COLORS.length
  ];

const round = (v: number) => Math.round(v * 10000) / 10000; // 0.1 ms
const fmt = (v: number) => String(round(v));

/**
 * Each symbol's from/to values and the doc positions of those NUMBERS, for a slice rack.
 * Null when the file isn't one.
 *
 * The positions come from the parser's own node ranges, which is the whole reason this is
 * short: every node carries `[start, valueEnd, nodeEnd]`, so "where is this number" is a
 * property of the parse rather than something to re-derive.
 */
export function scanSlices(doc: string): SliceSym[] | null {
  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(doc, { version: "1.2" });
  } catch {
    return null;
  }
  if (parsed.errors.length) return null; // mid-keystroke; keep the picture we have
  const rack = parsed.get("rack");
  if (!isMap(rack)) return null;
  if (rack.get("rack_type") !== "slice") return null;
  const symbols = rack.get("symbols");
  if (!isMap(symbols)) return null;

  const out: SliceSym[] = [];
  for (const item of symbols.items) {
    const key = item.key as {
      value?: unknown;
      range?: [number, number, number];
    };
    const symbol = key?.value;
    const body = item.value;
    if (typeof symbol !== "string" || !isMap(body)) continue;
    const from = body.get("from", true);
    const to = body.get("to", true);
    if (!isScalar(from) || !isScalar(to)) continue;
    const fromN = Number(from.value);
    const toN = Number(to.value);
    if (!Number.isFinite(fromN) || !Number.isFinite(toN)) continue;
    if (!from.range || !to.range || !key.range) continue;
    out.push({
      symbol,
      from: fromN,
      to: toN,
      fromRange: [from.range[0], from.range[1]],
      toRange: [to.range[0], to.range[1]],
      keyRange: [key.range[0], key.range[1]],
    });
  }
  return out.length ? out : null;
}

/**
 * A rack's slice windows as the dock draws them: coloured by their position among the symbols
 * that HAVE a window, which is the same basis `sliceSymbolColors` indexes on (scanSlices skips
 * a windowless symbol too) — so the third window and the third painted name share a hue.
 */
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

/**
 * Rewrite one symbol's `from`/`to` NUMBERS in the doc — what the docked slicer's drag commits.
 * The edit flows through the buffer like a keystroke, so it is visible before it is saved and
 * undoable by the editor's own history. Null when the doc holds no such symbol (the caller's
 * buffer is not the file the slice lives in), so a stray drag writes nowhere.
 */
export function setSliceWindow(
  text: string,
  symbol: string,
  from: number,
  to: number,
): string | null {
  const s = scanSlices(text)?.find((x) => x.symbol === symbol);
  if (!s) return null;
  // The LATER range first, so the earlier one's positions stay true while both are replaced.
  const edits = [
    { range: s.fromRange, val: fmt(from) },
    { range: s.toRange, val: fmt(to) },
  ].sort((a, b) => b.range[0] - a.range[0]);
  let out = text;
  for (const e of edits)
    out = out.slice(0, e.range[0]) + e.val + out.slice(e.range[1]);
  return out;
}

/**
 * The symbol names, painted in their slice's colour — the link between a line of YAML and a
 * window on the docked waveform, made by hue rather than by reading. A StateField rebuilt on
 * every doc change, exactly the cost the old inline widgets paid for the same scan; a file that
 * is not a slice rack decorates nothing.
 */
export function sliceSymbolColors(): Extension {
  const build = (state: EditorState): DecorationSet => {
    const syms = scanSlices(state.doc.toString());
    if (!syms) return Decoration.none;
    const b = new RangeSetBuilder<Decoration>();
    syms.forEach((s, i) => {
      b.add(
        s.keyRange[0],
        s.keyRange[1],
        Decoration.mark({
          attributes: {
            style: `color:${sliceColor(i)};font-weight:600`,
          },
        }),
      );
    });
    return b.finish();
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}
