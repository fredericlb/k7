// plugin.ts — mounts a sequence's `notes` list as an interactive grid (piano roll
// or tracker) in a plain filling pane, handing back the whole next file content on an edit.
// No CodeMirror here despite the name: the subpath is what its hosts import. See docs/noteGrids.md.

import {
  seqWindowFromText,
  type WindowSpan,
  windowSpan,
} from "@studio/song-schema/seqWindow";
import { type Note, type RackInfo, readSequence, writeNotes } from "./notes";
import { renderRollGrid } from "./RollGrid";
import { makeTrackerCtx, renderTrackerGrid } from "./TrackerGrid";

function buildRackInfo(rack: RackHint | undefined): RackInfo | null {
  const entries = rack?.symbols;
  if (!entries?.length) return null;
  const toSymbol = new Map<number, string>();
  const toNote = new Map<string, number>();
  for (const e of entries) {
    toSymbol.set(e.note, e.symbol);
    toNote.set(e.symbol, e.note);
  }
  return {
    toSymbol,
    toNote,
    order: [...entries]
      .map((e) => ({ symbol: e.symbol, note: e.note }))
      .sort((a, b) => a.note - b.note),
  };
}

/** The window the document states, in beats, at 4/4 like the rest of these grids — see docs/noteGrids.md. */
function docWindow(doc: string, notes: Note[]): WindowSpan | null {
  const win = seqWindowFromText(doc);
  if (!win) return null;
  // The extent rounded UP TO THE BAR, the same default `to` the compiler uses.
  const extent =
    Math.ceil(notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) / 4) * 4;
  return windowSpan(win, extent);
}

// A rack module as the hints describe it: with `use_rack`, the grids show and enter notes by symbol.
export interface RackHint {
  rackType?: "samples" | "slice";
  source?: string;
  symbols: { symbol: string; note: number; from?: number; to?: number }[];
}

// The same grids in a plain FILLING container, re-rendered from OUTSIDE so an edit and a reformat share one path.

export interface SeqGridController {
  update(content: string): void; // re-render for new content (a grid edit or a save reformat)
  destroy(): void;
}
export interface SeqGridOptions {
  view: "roll" | "tracker";
  content: string;
  racks?: Record<string, RackHint>;
  onChange: (nextContent: string) => void; // the WHOLE next file content, notes rewritten
}

export function mountSeqGrid(
  container: HTMLElement,
  opts: SeqGridOptions,
): SeqGridController {
  const ctx = opts.view === "tracker" ? makeTrackerCtx() : null;
  let content = opts.content;

  const render = () => {
    const read = readSequence(content);
    if (!read) {
      container.replaceChildren(); // no notes list (not a sequence) — leave it empty
      return;
    }
    const { notes, useRack } = read;
    const rack = buildRackInfo(useRack ? opts.racks?.[useRack] : undefined);
    const onGridChange = (next: Note[]) => {
      const text = writeNotes(content, next);
      if (text !== null) opts.onChange(text);
    };
    const win = docWindow(content, notes);
    const grid =
      opts.view === "tracker"
        ? renderTrackerGrid(notes, ctx!, onGridChange, rack, win)
        : renderRollGrid(notes, onGridChange, rack, win);
    grid.style.height = "100%";
    container.replaceChildren(grid);
  };

  render();

  return {
    update(next: string) {
      if (next === content) return; // unchanged — keep the live grid (and its focus)
      content = next;
      render();
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
