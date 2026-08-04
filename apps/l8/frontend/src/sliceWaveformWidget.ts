// sliceWaveformWidget.ts — under each symbol line of a slice-rack module file, a CodeMirror
// BLOCK widget drawing the source's waveform with that symbol's [from,to] window and
// draggable edges; a drag rewrites the number in the doc, so it flows through the editor
// like any other edit. Block decorations need a StateField, hence `[field, theme]`.

import { RangeSetBuilder, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { isMap, isScalar, parseDocument } from "yaml";

// The source waveform, reduced to what the widget draws.
export interface SliceEnvelope {
  rms: number[]; // 0..1 per bucket, left→right across the whole source
  seconds: number; // source duration
  // Detected onsets in SOURCE seconds — slicing a break is aiming at these, so the marks are the targets.
  transients: number[];
}

export interface SliceSym {
  symbol: string;
  from: number; // seconds
  to: number;
  fromRange: [number, number]; // doc positions of the `from` NUMBER (for the edit)
  toRange: [number, number];
  anchor: number; // doc position inside the symbol struct (to place the widget under its line)
}

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
  if (parsed.errors.length) return null; // mid-keystroke; keep the widgets we have
  const rack = parsed.get("rack");
  if (!isMap(rack)) return null;
  if (rack.get("rack_type") !== "slice") return null;
  const symbols = rack.get("symbols");
  if (!isMap(symbols)) return null;

  const out: SliceSym[] = [];
  for (const item of symbols.items) {
    const symbol = (item.key as { value?: unknown })?.value;
    const body = item.value;
    if (typeof symbol !== "string" || !isMap(body)) continue;
    const from = body.get("from", true);
    const to = body.get("to", true);
    if (!isScalar(from) || !isScalar(to)) continue;
    const fromN = Number(from.value);
    const toN = Number(to.value);
    if (!Number.isFinite(fromN) || !Number.isFinite(toN)) continue;
    if (!from.range || !to.range || !body.range) continue;
    out.push({
      symbol,
      from: fromN,
      to: toN,
      fromRange: [from.range[0], from.range[1]],
      toRange: [to.range[0], to.range[1]],
      // Place the widget under the symbol's LAST line, so a multiline symbol gets it below the whole block.
      anchor: body.range[1],
    });
  }
  return out.length ? out : null;
}

function drawEnv(
  ctx: CanvasRenderingContext2D,
  rms: number[],
  w: number,
  h: number,
  color: string,
): void {
  const n = rms.length;
  if (!n) return;
  ctx.fillStyle = color;
  const bw = Math.max(1, w / n);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(1, rms[i]));
    const bh = Math.max(1, v * (h - 8));
    ctx.fillRect((i / n) * w, (h - bh) / 2, bw, bh);
  }
}

// Onsets as dashed rules, matching WaveformView's overlay so a transient reads the same wherever it is drawn.
function drawTransients(
  ctx: CanvasRenderingContext2D,
  transients: number[],
  seconds: number,
  w: number,
  h: number,
): void {
  if (!transients.length || seconds <= 0) return;
  ctx.save();
  ctx.strokeStyle = "rgba(250,204,21,0.55)"; // yellow-400; stronger than the big view's
  ctx.lineWidth = 1; //  0.3 — this canvas is 46px tall, not a full pane
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  for (const t of transients) {
    // Snap to the pixel grid: a 1px line on a half-pixel renders as two grey ones.
    const x =
      Math.floor((Math.max(0, Math.min(seconds, t)) / seconds) * w) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  ctx.restore();
}

const WAVE_H = 46; // px

class SliceWidget extends WidgetType {
  constructor(
    readonly sym: SliceSym,
    readonly env: SliceEnvelope | null,
  ) {
    super();
  }

  eq(o: SliceWidget): boolean {
    return (
      o.sym.symbol === this.sym.symbol &&
      o.sym.from === this.sym.from &&
      o.sym.to === this.sym.to &&
      o.sym.fromRange[0] === this.sym.fromRange[0] &&
      o.sym.toRange[0] === this.sym.toRange[0] &&
      o.env === this.env
    );
  }

  // The block height must be known up front or the line-number gutter drifts: label + canvas + margin.
  get estimatedHeight(): number {
    return WAVE_H + 24;
  }

  toDOM(view: EditorView): HTMLElement {
    const env = this.env;
    const seconds = env?.seconds ?? 0;
    const wrap = document.createElement("div");
    wrap.className = "cm-slice-wave";

    const label = document.createElement("div");
    label.className = "cm-slice-label";
    wrap.appendChild(label);

    const canvas = document.createElement("canvas");
    canvas.className = "cm-slice-canvas";
    // Fix the LAYOUT size synchronously: a bare <canvas> is 150px tall, and a late theme rule would shift the gutter.
    canvas.style.width = "100%";
    canvas.style.height = `${WAVE_H}px`;
    wrap.appendChild(canvas);

    // Live values during a drag (the doc isn't touched until release).
    let liveFrom = this.sym.from;
    let liveTo = this.sym.to;

    const setLabel = () => {
      label.textContent = `${this.sym.symbol}  ${liveFrom.toFixed(3)}s – ${liveTo.toFixed(3)}s`;
    };
    setLabel(); // synchronously — so the label's height is included in the mount measure

    const mkHandle = () => {
      const h = document.createElement("div");
      h.className = "cm-slice-handle";
      wrap.appendChild(h);
      return h;
    };
    const fromH = env ? mkHandle() : null;
    const toH = env ? mkHandle() : null;

    const redraw = () => {
      setLabel();
      if (!env || seconds <= 0) return;
      const w = canvas.clientWidth || wrap.clientWidth || 320;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.round(WAVE_H * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, WAVE_H);
      const xOf = (sec: number) => (sec / seconds) * w;
      const x1 = xOf(liveFrom);
      const x2 = xOf(liveTo);
      // Full envelope dim, the slice window brighter (clipped), then a violet frame.
      drawEnv(ctx, env.rms, w, WAVE_H, "rgba(200,160,106,0.28)");
      ctx.fillStyle = "rgba(139,92,246,0.14)";
      ctx.fillRect(x1, 0, x2 - x1, WAVE_H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x1, 0, x2 - x1, WAVE_H);
      ctx.clip();
      drawEnv(ctx, env.rms, w, WAVE_H, "rgba(200,160,106,0.9)");
      ctx.restore();
      // Onsets under the frame but over both envelopes: a mark hidden by the bright fill is no use when cutting a break.
      drawTransients(ctx, env.transients, seconds, w, WAVE_H);
      ctx.strokeStyle = "rgba(139,92,246,0.9)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x1, 0.75, Math.max(0, x2 - x1), WAVE_H - 1.5);
      if (fromH) fromH.style.left = `${x1}px`;
      if (toH) toH.style.left = `${x2}px`;
    };

    // Draw once the element has a width, and whenever it resizes with the pane.
    requestAnimationFrame(redraw);
    const ro = new ResizeObserver(() => redraw());
    ro.observe(wrap);
    (wrap as unknown as { _ro?: ResizeObserver })._ro = ro;

    const secAt = (clientX: number): number => {
      const rect = canvas.getBoundingClientRect();
      const frac = rect.width ? (clientX - rect.left) / rect.width : 0;
      return Math.max(0, Math.min(seconds, frac * seconds));
    };

    const beginDrag =
      (side: "from" | "to", handle: HTMLElement) => (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const MIN = 0.001;
        const move = (ev: PointerEvent) => {
          const sec = secAt(ev.clientX);
          if (side === "from") liveFrom = Math.min(sec, liveTo - MIN);
          else liveTo = Math.max(sec, liveFrom + MIN);
          redraw();
        };
        const end = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("lostpointercapture", end);
          // Commit by replacing just the dragged number; positions captured at build stay valid, the doc being unchanged.
          const range = side === "from" ? this.sym.fromRange : this.sym.toRange;
          const val = side === "from" ? liveFrom : liveTo;
          view.dispatch({
            changes: { from: range[0], to: range[1], insert: fmt(val) },
          });
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("lostpointercapture", end);
      };
    if (fromH) fromH.addEventListener("pointerdown", beginDrag("from", fromH));
    if (toH) toH.addEventListener("pointerdown", beginDrag("to", toH));

    return wrap;
  }

  destroy(dom: HTMLElement): void {
    (dom as unknown as { _ro?: ResizeObserver })._ro?.disconnect();
  }

  ignoreEvent(): boolean {
    return true; // our own pointer handlers manage the drag; don't move the caret
  }
}

// Build the block decorations for the current doc + envelope.
function build(
  doc: string,
  lineAt: (pos: number) => { to: number },
  env: SliceEnvelope | null,
): DecorationSet {
  const slices = scanSlices(doc);
  if (!slices) return Decoration.none;
  // A block widget must be added at a line boundary in ascending order — symbols come in source order already.
  const items = slices
    .map((s) => ({ s, pos: lineAt(Math.min(s.anchor, doc.length)).to }))
    .sort((a, b) => a.pos - b.pos);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { s, pos } of items)
    builder.add(
      pos,
      pos,
      Decoration.widget({
        widget: new SliceWidget(s, env),
        block: true,
        side: 1,
      }),
    );
  return builder.finish();
}

const theme = EditorView.baseTheme({
  ".cm-slice-wave": {
    position: "relative",
    // Vertical space via PADDING, counted in the measured block height, so the line-number gutter stays aligned.
    marginLeft: "2ch",
    padding: "2px 0 6px 0",
    boxSizing: "border-box",
  },
  ".cm-slice-label": {
    font: "10px ui-monospace, monospace",
    color: "rgba(139,92,246,0.9)",
    padding: "1px 0",
    userSelect: "none",
  },
  ".cm-slice-canvas": {
    display: "block",
    width: "100%",
    height: `${WAVE_H}px`,
    borderRadius: "4px",
    background: "rgba(0,0,0,0.22)",
  },
  ".cm-slice-handle": {
    position: "absolute",
    // sit over the canvas (below the label), straddling the edge for an easy grab
    top: "16px",
    height: `${WAVE_H}px`,
    width: "12px",
    marginLeft: "-6px",
    cursor: "ew-resize",
    touchAction: "none",
    background: "transparent",
  },
  ".cm-slice-handle:hover": {
    background: "rgba(139,92,246,0.25)",
  },
});

// The extension: inline slice editors for the async-loaded envelope, rebuilt when that envelope changes.
export function sliceWaveformWidgets(env: SliceEnvelope | null) {
  const field = StateField.define<DecorationSet>({
    create: (state) =>
      build(state.doc.toString(), (p) => state.doc.lineAt(p), env),
    update: (deco, tr) =>
      tr.docChanged
        ? build(tr.state.doc.toString(), (p) => tr.state.doc.lineAt(p), env)
        : deco,
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, theme];
}
