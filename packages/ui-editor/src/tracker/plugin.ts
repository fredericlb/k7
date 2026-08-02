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

// Turn a note list into grid DOM; `onChange` persists the whole next list, and `rack` lets it work in symbols.
type GridFactory = (
  notes: Note[],
  onChange: (next: Note[]) => void,
  rack: RackInfo | null,
) => HTMLElement;

// What the fullscreen frame must keep clear, in viewport px — a callback, measured at toggle time, so this
// package never learns what the shell around it looks like.
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
  ) {
    super();
  }
  eq(other: GridWidget) {
    return (
      other.arrayText === this.arrayText &&
      other.make === this.make &&
      other.rackKey === this.rackKey
    );
  }
  toDOM(view: EditorView): HTMLElement {
    // Two layers: `wrap` keeps the inline height so CodeMirror's line layout never sees the toggle, while `frame`
    // holds the grid and, fullscreen, floats over the shell between the insets the app measured.
    const wrap = document.createElement("div");
    wrap.style.cssText = `display:block;position:relative;height:${this.height}px;margin:2px 0`;

    const frame = document.createElement("div");
    const btn = document.createElement("button");

    // Fullscreen esc means "back to inline" first: a window CAPTURE listener, outranking the tracker's own Escape and
    // the shell's bindings, and needing no focus. Attached only while fullscreen; destroy covers a rebuild mid-flight.
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
    return Decoration.set([
      Decoration.replace({
        widget: new GridWidget(
          doc.slice(span.from, span.to),
          make,
          height,
          full,
          inset,
          rack,
          rack ? (useRack ?? "") : "",
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
    (notes, onChange, rack) => renderTrackerGrid(notes, ctx, onChange, rack),
    320,
    opts.fullscreenInset ?? NO_INSET,
    opts.racks,
  );
}

// --- Standalone grid pane (replaces the whole editor, not an inline widget) -----------
// mountSeqGrid renders the same grids into a plain FILLING container, so the editor can replace the file view.
// A grid edit hands the WHOLE next content to onChange, and re-render is driven from OUTSIDE (controller.update),
// so an edit and an external reformat share one path with no re-entrant rebuild mid-event.

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
    const grid =
      opts.view === "tracker"
        ? renderTrackerGrid(notes, ctx!, onGridChange, rack)
        : renderRollGrid(notes, onGridChange, rack);
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
