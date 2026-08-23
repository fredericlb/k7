// plugin.ts — the CodeMirror extensions that replace a sequence's inline `notes:` array
// with an interactive grid (piano roll or tracker), in place, leaving the wrapper text
// visible. An edit dispatches a transaction rewriting the list, so it flows through the
// editor's normal onChange -> Save path. See docs/noteGrids.md.

import { type Extension, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import {
  seqWindowFromText,
  type WindowSpan,
  windowSpan,
} from "@studio/song-schema/seqWindow";
import {
  findNotesArray,
  type Note,
  parseNotes,
  type RackInfo,
  renderNotes,
} from "./notes";
import { renderRollGrid } from "./RollGrid";
import { makeTrackerCtx, renderTrackerGrid } from "./TrackerGrid";

function buildRackInfo(rack: RackHint | undefined): RackInfo | null {
  const entries = rack?.symbols;
  if (!entries || !entries.length) return null;
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

// The rack a sequence names via `use_rack` — it sits OUTSIDE the notes array, so the grids can't find it alone.
const findUseRack = (doc: string): string | null => {
  // Quotes optional, because YAML doesn't quote a plain scalar: `use_rack: drums`.
  const m = doc.match(/(?:^|[\s{,])use_rack\s*:\s*"?([^"\n,}]+)"?/);
  return m ? m[1].trim() || null : null;
};

// Turn a note list into grid DOM, where `win` is the file's own from/to drawn as the grid's ground.
type GridFactory = (
  notes: Note[],
  onChange: (next: Note[]) => void,
  rack: RackInfo | null,
  win: WindowSpan | null,
) => HTMLElement;

/** The window the document states, in beats, at 4/4 like the rest of these grids — see docs/noteGrids.md. */
function docWindow(doc: string, notes: Note[]): WindowSpan | null {
  const win = seqWindowFromText(doc);
  if (!win) return null;
  // The extent rounded UP TO THE BAR, the same default `to` the compiler uses.
  const extent =
    Math.ceil(notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) / 4) * 4;
  return windowSpan(win, extent);
}

// What identifies a window for a widget's `eq`, since editing `from:` leaves the notes array untouched.
const winKeyOf = (w: WindowSpan | null) => (w ? `${w.from}:${w.to}` : "");

// What the fullscreen frame must keep clear, in viewport px — a callback measured at toggle time.
export interface RackHint {
  rackType?: "samples" | "slice";
  source?: string;
  symbols: { symbol: string; note: number; from?: number; to?: number }[];
}

export interface GridFrameOptions {
  fullscreenInset?: () => { top: number; bottom: number };
  // Rack modules -> their rack, from the hints: with use_rack, the grids show and enter notes by symbol.
  racks?: Record<string, RackHint>;
}
type InsetFn = NonNullable<GridFrameOptions["fullscreenInset"]>;

// lucide maximize-2 / minimize-2, inlined — this DOM is outside the React tree.
const ICON = (paths: string) =>
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const MAXIMIZE = ICON(
  '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
);
const MINIMIZE = ICON(
  '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
);

class GridWidget extends WidgetType {
  // Keyed on the array text AND the factory, so the widget rebuilds on a note change or a view switch, not on any edit.
  constructor(
    readonly arrayText: string,
    readonly make: GridFactory,
    readonly height: number,
    // Plugin-instance state, like the tracker's ctx: the widget rebuilds on every edit, and fullscreen must survive it.
    readonly full: { on: boolean },
    readonly inset: InsetFn,
    // The resolved rack plus a key identifying it, so the grid rebuilds when use_rack changes, not only the notes.
    readonly rack: RackInfo | null,
    readonly rackKey: string,
    // The file's window, and a key for it: editing `from:` changes neither the notes nor the rack.
    readonly win: WindowSpan | null,
    readonly winKey: string,
  ) {
    super();
  }
  eq(other: GridWidget) {
    return (
      other.arrayText === this.arrayText &&
      other.make === this.make &&
      other.rackKey === this.rackKey &&
      other.winKey === this.winKey
    );
  }
  toDOM(view: EditorView): HTMLElement {
    // Two layers: `wrap` keeps the inline height so the line layout never sees the toggle, `frame` holds the grid.
    const wrap = document.createElement("div");
    wrap.style.cssText = `display:block;position:relative;height:${this.height}px;margin:2px 0`;

    const frame = document.createElement("div");
    const btn = document.createElement("button");

    // Fullscreen esc means "back to inline" first: a window CAPTURE listener outranking every other Escape.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      this.full.on = false;
      apply();
      e.preventDefault();
      e.stopPropagation();
    };

    const apply = () => {
      const base =
        "border:1px solid var(--sh-border,#333);border-radius:4px;overflow:hidden;background:var(--sh-background,#111)";
      if (this.full.on) {
        const { top, bottom } = this.inset();
        // z-30: over the panes and bottom bars, under the settings overlay (z-40).
        frame.style.cssText = `${base};position:fixed;left:0;right:0;top:${top}px;bottom:${bottom}px;z-index:30`;
      } else {
        frame.style.cssText = `${base};position:absolute;inset:0`;
      }
      window.removeEventListener("keydown", esc, true);
      if (this.full.on) window.addEventListener("keydown", esc, true);
      btn.title = this.full.on ? "exit fullscreen (esc)" : "fullscreen";
      btn.innerHTML = this.full.on ? MINIMIZE : MAXIMIZE;
    };
    this.cleanup = () => window.removeEventListener("keydown", esc, true);

    btn.type = "button";
    btn.style.cssText =
      "position:absolute;top:4px;right:16px;z-index:5;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--sh-border,#333);border-radius:4px;background:var(--sh-background,#111);color:var(--sh-muted-foreground,#888);cursor:pointer;opacity:0.7";
    btn.addEventListener("mouseenter", () => (btn.style.opacity = "1"));
    btn.addEventListener("mouseleave", () => (btn.style.opacity = "0.7"));
    // Don't let the click steal focus — the tracker's cursor lives on its own focus.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      this.full.on = !this.full.on;
      apply();
    });

    frame.appendChild(
      this.make(
        parseNotes(this.arrayText),
        (next) => {
          // Re-locate the array at dispatch time — its offsets shift as the doc is edited — then replace exactly that span.
          const span = findNotesArray(view.state.doc.toString());
          if (!span) return;
          view.dispatch({
            changes: {
              from: span.from,
              to: span.to,
              insert: renderNotes(next, span.indent),
            },
          });
        },
        this.rack,
        this.win,
      ),
    );
    frame.appendChild(btn);
    apply();
    wrap.appendChild(frame);
    return wrap;
  }
  // Set by toDOM; unhooks the fullscreen esc listener when CM drops this DOM.
  private cleanup: (() => void) | null = null;
  destroy() {
    this.cleanup?.();
  }
  ignoreEvent() {
    return true; // the grid handles its own mouse/key events
  }
}

function gridField(
  make: GridFactory,
  height: number,
  inset: InsetFn,
  racks?: GridFrameOptions["racks"],
): Extension {
  // Outlives widget rebuilds (see GridWidget.full) — one flag per plugin instance.
  const full = { on: false };
  const build = (doc: string): DecorationSet => {
    const span = findNotesArray(doc);
    if (!span) return Decoration.none;
    // use_rack sits outside the notes array, so read it from the whole doc and resolve against the hints' rack map.
    const useRack = findUseRack(doc);
    const rack = buildRackInfo(useRack ? racks?.[useRack] : undefined);
    const arrayText = doc.slice(span.from, span.to);
    // Read from the WHOLE doc: from/to sit outside the notes array, like use_rack.
    const win = docWindow(doc, parseNotes(arrayText));
    return Decoration.set([
      Decoration.replace({
        widget: new GridWidget(
          arrayText,
          make,
          height,
          full,
          inset,
          rack,
          rack ? (useRack ?? "") : "",
          win,
          winKeyOf(win),
        ),
      }).range(span.from, span.to),
    ]);
  };
  return StateField.define<DecorationSet>({
    create: (state) => build(state.doc.toString()),
    update: (deco, tr) =>
      tr.docChanged ? build(tr.state.doc.toString()) : deco,
    provide: (f) => [
      EditorView.decorations.from(f),
      // Atomic so the caret treats the grid as one unit and can't land inside it.
      EditorView.atomicRanges.of(
        (view) => view.state.field(f) ?? Decoration.none,
      ),
    ],
  });
}

const NO_INSET: InsetFn = () => ({ top: 0, bottom: 0 });

// The piano-roll view. Stateless — a rebuild just redraws it.
export function rollGridPlugin(opts: GridFrameOptions = {}): Extension {
  return gridField(
    renderRollGrid,
    320,
    opts.fullscreenInset ?? NO_INSET,
    opts.racks,
  );
}

// The tracker view. Its cursor and focus live in a ctx owned HERE, so a rebuild after each edit lands the caret back.
export function trackerPlugin(opts: GridFrameOptions = {}): Extension {
  const ctx = makeTrackerCtx();
  return gridField(
    (notes, onChange, rack, win) =>
      renderTrackerGrid(notes, ctx, onChange, rack, win),
    320,
    opts.fullscreenInset ?? NO_INSET,
    opts.racks,
  );
}

// --- Standalone grid pane (replaces the whole editor, not an inline widget) -----------

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
    const span = findNotesArray(content);
    if (!span) {
      container.replaceChildren(); // no notes array (not a sequence) — leave it empty
      return;
    }
    const notes = parseNotes(content.slice(span.from, span.to));
    const useRack = findUseRack(content);
    const rack = buildRackInfo(useRack ? opts.racks?.[useRack] : undefined);
    const onGridChange = (next: Note[]) => {
      const s = findNotesArray(content);
      if (!s) return;
      opts.onChange(
        content.slice(0, s.from) + renderNotes(next) + content.slice(s.to),
      );
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
