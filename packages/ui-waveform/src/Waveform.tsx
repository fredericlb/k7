import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  labelled,
  labelMinPx,
  labelStride,
  MAX_COLUMN_PX,
  nearestTick,
} from "./ticks";
import type {
  Annotation,
  DetectedEvent,
  Envelope,
  Marker,
  Selection,
  WaveformGrid,
} from "./types";

interface Props {
  envelope: Envelope;
  duration: number;
  threshold?: number; // absence hides the threshold line
  events?: DetectedEvent[];
  annotations?: Annotation[];
  markers?: Marker[];
  gridLines?: WaveformGrid[]; // optional bar/beat overlay
  height?: number; // canvas height in px; defaults to DEFAULT_HEIGHT
  currentTime: number;
  selection?: Selection | null;
  onSeek?: (sec: number) => void;
  onSelect?: (sel: Selection) => void;
  // Clicking a marker pin seeks to it by default; the host can override (e.g. to
  // also scroll its row into view).
  onMarkerClick?: (marker: Marker) => void;
  // Live draft range of the moment currently being range-edited (null when not
  // editing). Dragging the edge handles updates it via onEditRange.
  editing?: Selection | null;
  onEditRange?: (range: Selection) => void;
}

const DEFAULT_HEIGHT = 160; // canvas height when no `height` prop is given
const MIN_DB = -120; // bottom of the vertical scale (0 dBFS at the top)
const DB_GRID = [0, -20, -40, -60, -80, -100];
const HANDLE_HIT = 9; // px from an edge that counts as grabbing its handle
const MIN_DUR = 0.1; // shortest allowed moment (s)
const GRID_DASH = [3, 4]; // the bar/beat rule's dash: on 3px, off 4px
const ENV_UNPLAYED = "150, 150, 163"; // grey — the material as a whole
const ENV_PLAYED = "139, 92, 246"; // accent purple — left of the playhead

// Stable defaults: a fresh `[]` per render is a new identity, which fired the draw effect on
// EVERY render of the host, playhead frame or not.
const NO_EVENTS: DetectedEvent[] = [];
const NO_ANNOTATIONS: Annotation[] = [];
const NO_MARKERS: Marker[] = [];
const NO_GRID: WaveformGrid[] = [];

const ampToDb = (amp: number): number =>
  amp > 0 ? 20 * Math.log10(amp) : MIN_DB;

// The dB scale, absolute: MIN_DB at the bottom, 0 dB (full scale) at the top. The envelope
// stores linear RMS where 1.0 == full scale.
const dbToYIn = (db: number, h: number): number => {
  const norm = Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB));
  return h - norm * h;
};

/**
 * One envelope contour rasterised onto a canvas of its own.
 *
 * It is the same picture on every frame — ~`width` quadratic segments, twice, plus a gradient —
 * and it used to be traced from scratch 20 times a second because the playhead shares the draw
 * effect. Drawn once here and blitted; see docs/layers.md.
 */
function envelopeLayer(
  ys: number[],
  width: number,
  height: number,
  dpr: number,
  rgb: string,
): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(width * dpr));
  cv.height = Math.max(1, Math.round(height * dpr));
  const ctx = cv.getContext("2d");
  if (!ctx || width < 2) return cv;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Smooth curve through the points via quadratic segments to the midpoints.
  const contour = () => {
    for (let x = 0; x < width - 1; x++) {
      const xc = (x + x + 1) / 2;
      const yc = (ys[x] + ys[x + 1]) / 2;
      ctx.quadraticCurveTo(x, ys[x], xc, yc);
    }
    ctx.lineTo(width - 1, ys[width - 1]);
  };

  // A soft filled area…
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, ys[0]);
  contour();
  ctx.lineTo(width - 1, height);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, `rgba(${rgb}, 0.22)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fill();

  // …under a top line.
  ctx.beginPath();
  ctx.moveTo(0, ys[0]);
  contour();
  ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.stroke();
  return cv;
}

function WaveformInner({
  envelope,
  duration,
  threshold,
  events = NO_EVENTS,
  annotations = NO_ANNOTATIONS,
  markers = NO_MARKERS,
  gridLines = NO_GRID,
  height = DEFAULT_HEIGHT,
  currentTime,
  selection = null,
  onSeek,
  onSelect,
  onMarkerClick,
  editing = null,
  onEditRange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);
  const [dragSel, setDragSel] = useState<Selection | null>(null);
  // Which edge of the editing moment is being dragged, if any.
  const editDrag = useRef<"start" | "end" | null>(null);

  // Track container width so the canvas is responsive.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.max(200, Math.floor(entries[0].contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The effective canvas height (prop, or the default). Aliased so all the drawing
  // below reads it as a plain HEIGHT, whether it fits a pane or uses the default.
  const HEIGHT = height;

  const total =
    duration || (envelope.samples.length * envelope.intervalMs) / 1000;
  const timeToX = (t: number) => (total > 0 ? (t / total) * width : 0);
  const xToTime = (x: number) => (width > 0 ? (x / width) * total : 0);
  const dbToY = (db: number) => dbToYIn(db, HEIGHT);

  // Taken apart from the object so an unstable `envelope` literal — which is what a host
  // building `{intervalMs, samples}` inline hands us — cannot invalidate the work below.
  const samples = envelope.samples;
  const intervalMs = envelope.intervalMs;

  /**
   * One y per pixel column: interpolate when zoomed in, average when zoomed out.
   *
   * A smoothing pass over every sample, then a pass over every pixel — both of which used to
   * run on each playhead frame, because they lived in the effect the transport also drives.
   * Neither depends on the transport.
   */
  const ys = useMemo(() => {
    const n = samples.length;
    const dt = intervalMs / 1000;
    const toTime = (x: number) => (width > 0 ? (x / width) * total : 0);
    // dB per sample, lightly averaged to take the edge off single-sample spikes.
    const R = 1; // smoothing radius, in samples
    const sdb = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let cnt = 0;
      for (let k = i - R; k <= i + R; k++) {
        if (k >= 0 && k < n) {
          sum += ampToDb(samples[k]);
          cnt++;
        }
      }
      sdb[i] = cnt ? sum / cnt : MIN_DB;
    }
    const out = new Array<number>(Math.max(1, width));
    for (let px = 0; px < width; px++) {
      const a = toTime(px) / dt;
      const b = toTime(px + 1) / dt;
      let db: number;
      if (b - a >= 1) {
        const i0 = Math.max(0, Math.floor(a));
        const i1 = Math.min(n, Math.ceil(b));
        let sum = 0;
        let cnt = 0;
        for (let i = i0; i < i1; i++) {
          sum += sdb[i];
          cnt++;
        }
        db = cnt ? sum / cnt : MIN_DB;
      } else {
        const c = (a + b) / 2;
        const i = Math.floor(c);
        const f = c - i;
        const v0 = sdb[Math.max(0, Math.min(n - 1, i))];
        const v1 = sdb[Math.max(0, Math.min(n - 1, i + 1))];
        db = v0 + (v1 - v0) * f;
      }
      out[px] = dbToYIn(db, HEIGHT);
    }
    return out;
  }, [samples, intervalMs, width, total, HEIGHT]);

  // The two contours, rasterised once each. The DPR is read here rather than tracked: a screen
  // change without a resize leaves them scaled until the next one, which is the cheap trade.
  const layers = useMemo(() => {
    const dpr = window.devicePixelRatio || 1;
    return {
      unplayed: envelopeLayer(ys, width, HEIGHT, dpr, ENV_UNPLAYED),
      played: envelopeLayer(ys, width, HEIGHT, dpr, ENV_PLAYED),
    };
  }, [ys, width, HEIGHT]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    // Background
    ctx.fillStyle = "#1b1c22";
    ctx.fillRect(0, 0, width, HEIGHT);

    // dB grid lines (labels drawn last, on top)
    ctx.lineWidth = 1;
    for (const db of DB_GRID) {
      const y = Math.round(dbToY(db)) + 0.5;
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Bar/beat gridlines (behind everything else): bars brighter, beats fainter, both
    // DASHED. The solid vertical lines on this canvas mean something — the playhead, a
    // marker, a selection edge — so the grid, which is every tick, reads as a rule instead
    // of competing with them. Labels are drawn last, on top. Used by the DAW clip editor.
    ctx.setLineDash(GRID_DASH);
    for (const g of gridLines) {
      const gx = Math.round(timeToX(g.t)) + 0.5;
      ctx.strokeStyle = g.bar
        ? "rgba(120,180,255,0.45)"
        : "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, HEIGHT);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Detected event regions (behind the bars)
    ctx.fillStyle = "rgba(80, 200, 120, 0.2)";
    for (const ev of events) {
      const x0 = timeToX(ev.startSec);
      const x1 = timeToX(ev.endSec);
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), HEIGHT);
    }

    // Annotation regions
    ctx.fillStyle = "rgba(240, 180, 60, 0.24)";
    for (const a of annotations) {
      const x0 = timeToX(a.startSec);
      const x1 = timeToX(a.endSec);
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), HEIGHT);
    }

    // Unplayed portion in grey; played portion (left of playhead) in the accent purple — the
    // SoundCloud-style progress fill. Both are pre-rasterised, so a frame costs two blits
    // rather than two traced contours, and the draw ORDER is unchanged: everything below still
    // lands on top of the fill.
    ctx.drawImage(layers.unplayed, 0, 0, width, HEIGHT);
    const playX = timeToX(currentTime);
    if (playX > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, playX, HEIGHT);
      ctx.clip();
      ctx.drawImage(layers.played, 0, 0, width, HEIGHT);
      ctx.restore();
    }

    // Threshold line (horizontal, at its dB level) — only when a threshold is set.
    if (threshold != null) {
      const ty = Math.round(dbToY(ampToDb(threshold))) + 0.5;
      ctx.strokeStyle = "rgba(255,90,90,0.7)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(width, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Active selection (in-progress drag takes precedence)
    const sel = dragSel || selection;
    if (sel) {
      const x0 = timeToX(Math.min(sel.start, sel.end));
      const x1 = timeToX(Math.max(sel.start, sel.end));
      ctx.fillStyle = "rgba(139,92,246,0.2)";
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), HEIGHT);
      ctx.strokeStyle = "rgba(139,92,246,0.85)";
      ctx.strokeRect(x0 + 0.5, 0.5, Math.max(1, x1 - x0), HEIGHT - 1);
    }

    // Moment being range-edited: its draft span plus grab handles at each edge.
    if (editing) {
      const ex0 = timeToX(Math.min(editing.start, editing.end));
      const ex1 = timeToX(Math.max(editing.start, editing.end));
      ctx.fillStyle = "rgba(139,92,246,0.18)";
      ctx.fillRect(ex0, 0, Math.max(1, ex1 - ex0), HEIGHT);
      ctx.strokeStyle = "rgba(139,92,246,0.95)";
      ctx.lineWidth = 2;
      for (const hx of [ex0, ex1]) {
        ctx.beginPath();
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, HEIGHT);
        ctx.stroke();
        ctx.fillStyle = "rgba(139,92,246,0.95)";
        ctx.fillRect(hx - 3, HEIGHT / 2 - 13, 6, 26);
      }
    }

    // Markers — a thin teal line at each pinned timestamp (interactive pins are
    // drawn as DOM overlays below so they can carry tooltips + click handlers).
    ctx.strokeStyle = "rgba(45, 212, 191, 0.9)";
    ctx.lineWidth = 1.5;
    for (const m of markers) {
      const mx = Math.round(timeToX(m.atSec)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, HEIGHT);
      ctx.stroke();
    }

    // Playhead
    const px = timeToX(currentTime);
    ctx.strokeStyle = "rgba(235,235,242,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, HEIGHT);
    ctx.stroke();

    // dB axis labels (on top of everything)
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    for (const db of DB_GRID) {
      const y = Math.round(dbToY(db));
      if (y > 10) ctx.fillText(`${db} dB`, 3, y - 1);
    }

    // Bar-number labels (top), on top of the gridlines they belong to. Thinned by powers
    // of two once they crowd (see ticks.ts) — the LINES still all draw, only the numbers
    // drop out, so the grid keeps its density while staying readable.
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(160,200,255,0.85)";
    // The producer labels BARS only (see beatGrid), but it sends a line per beat. Once a
    // bar is wide enough to hold them, number those beats too — bar.beat, the same 5.2
    // the timeline's ruler shows. It cannot go finer than a beat: the sub-beat lines
    // simply aren't in the data, which is why this subdivides one step and stops.
    const bars = gridLines.filter((g) => g.bar);
    const barGap =
      bars.length > 1
        ? timeToX(bars[1].t) - timeToX(bars[0].t)
        : Number.POSITIVE_INFINITY;
    const showBeats = Number.isFinite(barGap) && barGap > MAX_COLUMN_PX;

    // Numbered from the ruler's origin, so panning can't change which ones survive.
    let barNo = 0;
    let beatNo = 0;
    const texts: { t: number; text: string; index: number }[] = [];
    gridLines.forEach((g) => {
      if (g.bar) {
        barNo = g.label ? Number(g.label) : barNo + 1;
        beatNo = 0;
        texts.push({ t: g.t, text: String(barNo), index: texts.length });
      } else if (showBeats) {
        beatNo += 1;
        texts.push({
          t: g.t,
          text: `${barNo}.${beatNo + 1}`,
          index: texts.length,
        });
      }
    });
    const gap =
      texts.length > 1
        ? timeToX(texts[1].t) - timeToX(texts[0].t)
        : Number.POSITIVE_INFINITY;
    // Against the widest number this ruler prints, not a flat minimum: "128.4" needs four
    // times the room "7" does, and the two smear together long before the lines do.
    const widest = texts.reduce(
      (w, t) => (t.text.length > w.length ? t.text : w),
      "",
    );
    const stride = labelStride(gap, labelMinPx(widest));
    texts.forEach((tx, i) => {
      if (labelled(i, stride)) ctx.fillText(tx.text, timeToX(tx.t) + 2, 2);
    });
  }, [
    width,
    height,
    layers,
    threshold,
    events,
    annotations,
    markers,
    gridLines,
    currentTime,
    selection,
    dragSel,
    editing,
    total,
  ]);

  // The grid's times alone — what a click snaps to (see nearestTick).
  const gridTimes = useMemo(() => gridLines.map((g) => g.t), [gridLines]);

  const localX = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(width, clientX - rect.left));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const x = localX(e.clientX);
    // When editing a moment, grabbing near an edge handle starts a resize
    // instead of a seek/select.
    if (editing && onEditRange) {
      const xs = timeToX(editing.start);
      const xe = timeToX(editing.end);
      if (Math.abs(x - xs) <= HANDLE_HIT) {
        editDrag.current = "start";
        return;
      }
      if (Math.abs(x - xe) <= HANDLE_HIT) {
        editDrag.current = "end";
        return;
      }
    }
    drag.current = { startX: x, moved: false };
    // Don't show a selection yet — a plain click should just move the playhead.
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const x = localX(e.clientX);
    // Resizing a moment's edge — update the live draft, keeping start < end.
    if (editDrag.current && editing && onEditRange) {
      const t = xToTime(x);
      if (editDrag.current === "start") {
        onEditRange({
          start: Math.max(0, Math.min(t, editing.end - MIN_DUR)),
          end: editing.end,
        });
      } else {
        onEditRange({
          start: editing.start,
          end: Math.min(total, Math.max(t, editing.start + MIN_DUR)),
        });
      }
      return;
    }
    if (!drag.current) return;
    if (!drag.current.moved && Math.abs(x - drag.current.startX) > 4) {
      drag.current.moved = true;
    }
    // Only render a selection once it's a genuine drag.
    if (drag.current.moved) {
      setDragSel({ start: xToTime(drag.current.startX), end: xToTime(x) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    // Finish a resize — the draft is already up to date; committing (and the
    // re-extraction it triggers) happens when the user clicks Apply.
    if (editDrag.current) {
      editDrag.current = null;
      return;
    }
    if (!drag.current) return;
    const x = localX(e.clientX);
    const { startX, moved } = drag.current;
    drag.current = null;
    setDragSel(null);
    if (!moved) {
      // A click lands on the nearest line the grid actually drew: you aimed at a tick, not
      // at a pixel. With no grid there is nothing to snap to — k7's waveform passes none —
      // and the seek stays exactly where the pointer was.
      const t = xToTime(x);
      onSeek?.(nearestTick(gridTimes, t) ?? t);
    } else {
      const a = xToTime(Math.min(startX, x));
      const b = xToTime(Math.max(startX, x));
      onSelect?.({ start: a, end: b });
    }
  };

  return (
    <div ref={wrapRef} className="waveform-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: HEIGHT, cursor: "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          editDrag.current = null;
          setDragSel(null);
        }}
      />
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className="waveform-marker"
          style={{ left: timeToX(m.atSec) }}
          title={m.comment || "Marker"}
          onClick={() => (onMarkerClick ? onMarkerClick(m) : onSeek?.(m.atSec))}
        >
          <span className="waveform-marker-flag">🚩</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Memoised, because the host that draws it under a clip editor re-renders on things this
 * component does not care about. Its props must be stable for that to bite: an inline
 * `envelope={{…}}` or a fresh `events={[]}` defeats it — see the module-level defaults above.
 */
export const Waveform = memo(WaveformInner);
