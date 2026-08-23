import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  labelled,
  labelMinPx,
  labelStride,
  MAX_COLUMN_PX,
  nearestTick,
  subdivideGrid,
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
  /** The span of the material to SHOW, in seconds; absent ⇒ all of it. Stays ABSOLUTE — see docs/marks.md. */
  view?: { start: number; end: number };
  /** Where a marker sits: a tab from the TOP, or a bubble near the foot of its line for onsets — see docs/marks.md. */
  markerPlace?: "top" | "low";
  /** A clip's STRETCH points in display seconds: `orig` is the source moment, `target` where its beat lands. */
  warps?: { orig: number; target: number }[];
  /** Place a stretch point at this second, on double-click; absent ⇒ a double-click means nothing. */
  onWarpAdd?: (atSec: number) => void;
  /** Right-click on a stretch point, handed back whole; absent ⇒ the browser's own menu — see docs/marks.md. */
  onWarpMenu?: (
    mark: { orig: number; target: number },
    x: number,
    y: number,
  ) => void;
  /** Drag a stretch point's TARGET, given back whole and committed on RELEASE — see docs/marks.md. */
  onWarpMove?: (mark: { orig: number; target: number }, toSec: number) => void;
  /** Onsets drawn as plain solid rules, in seconds — measured moments as BACKDROP, not something to grab. */
  onsets?: number[];
  /** The span of the source this clip IS, drawn as GROUND under the envelope; absent ⇒ the picture already IS the window. */
  sourceWindow?: { from: number; to: number } | null;
  gridLines?: WaveformGrid[]; // optional bar/beat overlay
  height?: number; // canvas height in px; defaults to DEFAULT_HEIGHT
  currentTime: number;
  selection?: Selection | null;
  onSeek?: (sec: number) => void;
  onSelect?: (sel: Selection) => void;
  // Clicking a marker pin seeks to it by default; the host can override, e.g. to scroll its row into view.
  onMarkerClick?: (marker: Marker) => void;
  /** Drag a marker to another time, committed on RELEASE; absent ⇒ the pins are click-only — see docs/marks.md. */
  onMarkerMove?: (marker: Marker, toSec: number) => void;
  /** Drag the `sourceWindow`'s two edges, committed on RELEASE; absent ⇒ the band cannot be touched. */
  onWindowMove?: (win: { from: number; to: number }) => void;
  // Live draft range of the moment currently being range-edited, null when not editing.
  editing?: Selection | null;
  onEditRange?: (range: Selection) => void;
}

const DEFAULT_HEIGHT = 160; // canvas height when no `height` prop is given
const MIN_DB = -120; // bottom of the vertical scale (0 dBFS at the top)
const DB_GRID = [0, -20, -40, -60, -80, -100];
const HANDLE_HIT = 9; // px from an edge that counts as grabbing its handle
const MIN_DUR = 0.1; // shortest allowed moment (s)
const GRID_DASH = [3, 4]; // the bar/beat rule's dash: on 3px, off 4px
/** How high the warp arrow's shaft sits, and how long its head is. */
const WARP_ARROW_Y = 12;
const WARP_ARROW_PX = 6;
const ENV_UNPLAYED = "150, 150, 163"; // grey — the material as a whole
const ENV_PLAYED = "139, 92, 246"; // accent purple — left of the playhead
/** How much of the contour's ink the PEAK curve behind it gets — see docs/envelopes.md. */
const PEAK_ALPHA = 0.45;

// Stable defaults: a fresh `[]` per render is a new identity, which fired the draw effect on every host render.
const NO_EVENTS: DetectedEvent[] = [];
const NO_ANNOTATIONS: Annotation[] = [];
const NO_MARKERS: Marker[] = [];
const NO_GRID: WaveformGrid[] = [];
const NO_WARPS: { orig: number; target: number }[] = [];
const NO_ONSETS: number[] = [];

const ampToDb = (amp: number): number =>
  amp > 0 ? 20 * Math.log10(amp) : MIN_DB;

// The dB scale, absolute: MIN_DB at the bottom, 0 dBFS at the top, both envelopes linear — see docs/envelopes.md.
const dbToYIn = (db: number, h: number): number => {
  const norm = Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB));
  return h - norm * h;
};

/** One y per pixel column: interpolate when zoomed in, average when zoomed out — run twice, see docs/envelopes.md. */
export function contourYs(
  samples: number[],
  intervalMs: number,
  width: number,
  v0: number,
  span: number,
  height: number,
): number[] {
  const n = samples.length;
  const dt = intervalMs / 1000;
  const toTime = (x: number) => (width > 0 ? v0 + (x / width) * span : v0);
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
      const s0 = sdb[Math.max(0, Math.min(n - 1, i))];
      const s1 = sdb[Math.max(0, Math.min(n - 1, i + 1))];
      db = s0 + (s1 - s0) * f;
    }
    out[px] = dbToYIn(db, height);
  }
  return out;
}

/** One envelope contour rasterised onto a canvas of its own, drawn once and then blitted — see docs/layers.md. */
function envelopeLayer(
  ys: number[],
  width: number,
  height: number,
  dpr: number,
  rgb: string,
  /** Scales both the fill and the line — 1 is the solid contour, less is the one behind it. */
  alpha = 1,
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
  grad.addColorStop(0, `rgba(${rgb}, ${0.22 * alpha})`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fill();

  // …under a top line.
  ctx.beginPath();
  ctx.moveTo(0, ys[0]);
  contour();
  ctx.strokeStyle = `rgba(${rgb}, ${0.9 * alpha})`;
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
  view,
  markerPlace = "top",
  warps = NO_WARPS,
  onWarpAdd,
  onWarpMove,
  onWarpMenu,
  onsets = NO_ONSETS,
  sourceWindow = null,
  gridLines = NO_GRID,
  height = DEFAULT_HEIGHT,
  currentTime,
  selection = null,
  onSeek,
  onSelect,
  onMarkerClick,
  onMarkerMove,
  onWindowMove,
  editing = null,
  onEditRange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);
  const [dragSel, setDragSel] = useState<Selection | null>(null);
  // The pin being dragged: `moved` is what tells a move from a click, so a mark meant for removal is not re-placed.
  const [markerDrag, setMarkerDrag] = useState<{
    id: string;
    atSec: number;
    moved: boolean;
  } | null>(null);
  // The window edge being dragged, with the pair it makes, so the band resizes under the hand rather than after the write.
  const [winDrag, setWinDrag] = useState<{
    edge: "from" | "to";
    from: number;
    to: number;
  } | null>(null);
  // Which edge of the editing moment is being dragged, if any.
  const editDrag = useRef<"start" | "end" | null>(null);
  // The stretch point being dragged, keyed by `orig` since the target is the thing moving — see docs/marks.md.
  const [warpDrag, setWarpDrag] = useState<{
    orig: number;
    target: number;
  } | null>(null);

  /** Track the container's width: measured synchronously first, then observed, and a zero is ignored — see docs/measuring.md. */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (w: number) => {
      if (w > 0) setWidth(Math.floor(w));
    };
    measure(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((e) => measure(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The effective canvas height, aliased so all the drawing below reads it as a plain HEIGHT.
  const HEIGHT = height;

  const total =
    duration || (envelope.samples.length * envelope.intervalMs) / 1000;

  /** The pair the two edge HANDLES sit on, which is not always the pair the band is drawn from — see docs/marks.md. */
  const winEdges =
    winDrag ?? sourceWindow ?? (onWindowMove ? { from: 0, to: total } : null);

  // The visible span; absent ⇒ the whole material, and everything crossing this boundary stays in ABSOLUTE seconds.
  const v0 = view ? Math.max(0, Math.min(view.start, total)) : 0;
  const v1 = view ? Math.max(v0, Math.min(view.end, total)) : total;
  const span = v1 > v0 ? v1 - v0 : total;
  const timeToX = (t: number) => (span > 0 ? ((t - v0) / span) * width : 0);
  const xToTime = (x: number) => (width > 0 ? v0 + (x / width) * span : v0);

  /** The lines BETWEEN the ones the host sent, derived here because the CLICK wants them too — see docs/ticks.md. */
  const subGrid = useMemo(
    () =>
      subdivideGrid(
        gridLines.map((g) => g.t),
        span > 0 ? width / span : 0,
      ),
    [gridLines, width, span],
  );
  const dbToY = (db: number) => dbToYIn(db, HEIGHT);

  // Taken apart from the object so an unstable `envelope` literal cannot invalidate the work below.
  const samples = envelope.samples;
  const intervalMs = envelope.intervalMs;

  /** One y per pixel column, memoised because neither of its two passes depends on the transport — see docs/layers.md. */
  const ys = useMemo(
    () => contourYs(samples, intervalMs, width, v0, span, HEIGHT),
    [samples, intervalMs, width, v0, span, HEIGHT],
  );
  /** …and the same again for the PEAK when the host has one, null otherwise — see docs/envelopes.md. */
  const peakYs = useMemo(
    () =>
      envelope.peak?.length
        ? contourYs(envelope.peak, intervalMs, width, v0, span, HEIGHT)
        : null,
    [envelope.peak, intervalMs, width, v0, span, HEIGHT],
  );

  // The two contours, rasterised once each; the DPR is read here rather than tracked, which is the cheap trade.
  const layers = useMemo(() => {
    const dpr = window.devicePixelRatio || 1;
    return {
      unplayed: envelopeLayer(ys, width, HEIGHT, dpr, ENV_UNPLAYED),
      played: envelopeLayer(ys, width, HEIGHT, dpr, ENV_PLAYED),
      // The peak behind it, in the same two colours so the progress fill still reads as one picture.
      peakUnplayed: peakYs
        ? envelopeLayer(peakYs, width, HEIGHT, dpr, ENV_UNPLAYED, PEAK_ALPHA)
        : null,
      peakPlayed: peakYs
        ? envelopeLayer(peakYs, width, HEIGHT, dpr, ENV_PLAYED, PEAK_ALPHA)
        : null,
    };
  }, [ys, peakYs, width, HEIGHT]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Only when it actually changed: assigning `width` reallocates the backing store — see docs/layers.md.
    const w = Math.round(width * dpr);
    const h = Math.round(HEIGHT * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    // What the resize used to reset for free, now asserted: transform here, every style set before use, `[]` restored.
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

    // Bar/beat gridlines behind everything else: bars brighter, beats fainter, both DASHED — see docs/marks.md.
    ctx.setLineDash(GRID_DASH);

    // The subdivisions first, so a beat's own line wins where the two round to one pixel.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (const t of subGrid) {
      const sx = Math.round(timeToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, HEIGHT);
      ctx.stroke();
    }
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

    // The material's window as GROUND, lit under everything else and deliberately colourless — see docs/marks.md.

    // The dragged pair while an edge is held: the band has to follow the hand, not the write.
    const shown = winDrag ?? sourceWindow;
    if (shown && shown.to > shown.from) {
      const wx0 = timeToX(shown.from);
      const wx1 = timeToX(shown.to);
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(wx0, 0, Math.max(1, wx1 - wx0), HEIGHT);
      // The EDGES carry it, not the wash, since the envelope's own fill is drawn on top of it.
      ctx.strokeStyle = "rgba(226,232,240,0.8)";
      ctx.lineWidth = 1.5;
      for (const ex of [wx0, wx1]) {
        const x = Math.round(ex) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, HEIGHT);
        ctx.stroke();
      }
    }

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

    // Unplayed grey, played purple, all pre-rasterised so a frame costs blits — see docs/layers.md.

    // The PEAK goes down first so the RMS sits inside it, both under the same playhead clip.
    const playX = timeToX(currentTime);
    const fill = (
      whole: HTMLCanvasElement | null,
      left: HTMLCanvasElement | null,
    ) => {
      if (!whole) return;
      ctx.drawImage(whole, 0, 0, width, HEIGHT);
      if (playX <= 0 || !left) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, playX, HEIGHT);
      ctx.clip();
      ctx.drawImage(left, 0, 0, width, HEIGHT);
      ctx.restore();
    };
    fill(layers.peakUnplayed, layers.peakPlayed);
    fill(layers.unplayed, layers.played);

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

    // Markers — a thin teal line at each pinned timestamp; the interactive pins are DOM overlays below.
    ctx.strokeStyle = "rgba(45, 212, 191, 0.9)";
    ctx.lineWidth = 1.5;
    for (const m of markers) {
      const mx = Math.round(timeToX(m.atSec)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, HEIGHT);
      ctx.stroke();
    }

    // Onsets as rules — ABOVE the envelope, below the stretch points, for the reason in docs/marks.md.
    ctx.strokeStyle = "rgba(203,213,225,0.5)";
    ctx.lineWidth = 1;
    for (const t of onsets) {
      const ox = Math.round(timeToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, HEIGHT);
      ctx.stroke();
    }

    // Stretch points: a dashed rule at the SOURCE moment, a solid blue one where its beat lands — see docs/marks.md.
    for (const w of warps) {
      // The one being dragged is drawn where the HAND is, matched on `orig` rather than on the target.
      const target =
        warpDrag && Math.abs(warpDrag.orig - w.orig) < 1e-9
          ? warpDrag.target
          : w.target;
      const ox = Math.round(timeToX(w.orig)) + 0.5;
      const tx = Math.round(timeToX(target)) + 0.5;
      ctx.strokeStyle = "rgba(235,235,242,0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgb(96,165,250)";
      ctx.fillStyle = "rgb(96,165,250)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, HEIGHT);
      ctx.stroke();
      // An ARROW rather than a plain connector, shaft only under WARP_ARROW_PX — see docs/marks.md.
      if (Math.abs(tx - ox) > 2) {
        const y = WARP_ARROW_Y;
        ctx.beginPath();
        ctx.moveTo(ox, y);
        ctx.lineTo(tx, y);
        ctx.stroke();
        if (Math.abs(tx - ox) > WARP_ARROW_PX) {
          const dir = tx > ox ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(tx, y);
          ctx.lineTo(tx - dir * WARP_ARROW_PX, y - WARP_ARROW_PX * 0.6);
          ctx.lineTo(tx - dir * WARP_ARROW_PX, y + WARP_ARROW_PX * 0.6);
          ctx.closePath();
          ctx.fill();
        }
      }
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

    // Bar-number labels on top of the gridlines they belong to, thinned by powers of two once they crowd (see ticks.ts).
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(160,200,255,0.85)";

    // The producer labels BARS only but sends a line per beat, so a wide enough bar numbers those beats as bar.beat.
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
    // Against the widest number this ruler prints, not a flat minimum — see docs/ticks.md.
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
    subGrid,
    currentTime,
    selection,
    dragSel,
    editing,
    total,
    // These five were partly missing, and the draw survived only by coincidence — see docs/marks.md.
    warps,
    warpDrag,
    onsets,
    sourceWindow,
    winDrag,
  ]);

  // The grid's times alone — what a click snaps to (see nearestTick), subdivisions included since they are drawn.
  const gridTimes = useMemo(
    () => [...gridLines.map((g) => g.t), ...subGrid].sort((a, b) => a - b),
    [gridLines, subGrid],
  );

  const localX = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(width, clientX - rect.left));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const x = localX(e.clientX);
    // When editing a moment, grabbing near an edge handle starts a resize instead of a seek/select.
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
    // Finish a resize — the draft is already up to date, and committing happens when the user clicks Apply.
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
      // A click lands on the nearest line the grid actually drew, and with no grid it stays where the pointer was.
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
        /** Sized in PIXELS, not `100%`, so the coordinate space and the box cannot drift — see docs/measuring.md. */
        style={{ width, height: HEIGHT, cursor: "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        /** A stretch point where you pointed: on DOUBLE-click, and unsnapped unlike every other click here — see docs/marks.md. */
        onDoubleClick={
          onWarpAdd ? (e) => onWarpAdd(xToTime(localX(e.clientX))) : undefined
        }
        onPointerCancel={() => {
          drag.current = null;
          editDrag.current = null;
          setDragSel(null);
        }}
      />
      {/* The window's two EDGES, on the same `timeToX` as the line each holds — see docs/marks.md. */}
      {onWindowMove &&
        winEdges &&
        (["from", "to"] as const).map((edge) => {
          const at = winEdges[edge];
          return (
            <button
              key={edge}
              type="button"
              className="waveform-edge"
              // CLAMPED into the strip, unlike the pins below, with the true second in the title — see docs/marks.md.
              style={{
                left: Math.max(0, Math.min(width, timeToX(at))),
                height: HEIGHT,
              }}
              title={`Drag to set the event's ${edge} (${at.toFixed(3)}s)`}
              aria-label={`window ${edge}`}
              onPointerDown={(e) => {
                e.stopPropagation(); // …or the canvas starts a selection under the same finger
                e.currentTarget.setPointerCapture(e.pointerId);
                // `edge` AFTER the spread: `winEdges` may itself be a drag in flight, carrying its own.
                setWinDrag({ ...winEdges, edge });
              }}
              onPointerMove={(e) => {
                if (winDrag?.edge !== edge) return;
                // Clamped to the FILE and kept a hair apart, since a window that crossed itself plays nothing.
                const sec = Math.max(
                  0,
                  Math.min(total, xToTime(localX(e.clientX))),
                );
                setWinDrag(
                  edge === "from"
                    ? { ...winDrag, from: Math.min(sec, winDrag.to - 0.001) }
                    : { ...winDrag, to: Math.max(sec, winDrag.from + 0.001) },
                );
              }}
              onPointerUp={() => {
                const d = winDrag;
                setWinDrag(null);
                if (d?.edge === edge) onWindowMove({ from: d.from, to: d.to });
              }}
              onPointerCancel={() => setWinDrag(null)}
            />
          );
        })}
      {/* A stretch point's TARGET as a grab handle on the blue rule, never its origin — see docs/marks.md. */}
      {onWarpMove &&
        warps.map((w) => {
          const held =
            warpDrag && Math.abs(warpDrag.orig - w.orig) < 1e-9
              ? warpDrag
              : null;
          const at = held ? held.target : w.target;
          return (
            <button
              key={`warp-${w.orig}`}
              type="button"
              className="waveform-edge"
              style={{
                left: Math.max(0, Math.min(width, timeToX(at))),
                height: HEIGHT,
              }}
              title={`Drag to move where ${w.orig.toFixed(3)}s lands (${at.toFixed(3)}s) — right-click for more`}
              aria-label="stretch point"
              // The host's menu and not the browser's, but only when it offers one.
              onContextMenu={
                onWarpMenu
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onWarpMenu(
                        { orig: w.orig, target: w.target },
                        e.clientX,
                        e.clientY,
                      );
                    }
                  : undefined
              }
              onPointerDown={(e) => {
                e.stopPropagation(); // …or the canvas starts a selection under the same finger
                e.currentTarget.setPointerCapture(e.pointerId);
                setWarpDrag({ orig: w.orig, target: w.target });
              }}
              onPointerMove={(e) => {
                if (!held) return;
                // NOT snapped, unlike every other click on this canvas, and that is the point of a warp.
                setWarpDrag({
                  orig: w.orig,
                  target: Math.max(
                    0,
                    Math.min(total, xToTime(localX(e.clientX))),
                  ),
                });
              }}
              onPointerUp={() => {
                const d = warpDrag;
                setWarpDrag(null);
                if (d && Math.abs(d.orig - w.orig) < 1e-9)
                  onWarpMove({ orig: w.orig, target: w.target }, d.target);
              }}
              onPointerCancel={() => setWarpDrag(null)}
            />
          );
        })}
      {/* Only the pins inside the window, since their `left` is absolute px — see docs/marks.md. */}
      {markers
        .filter((m) => m.atSec >= v0 && m.atSec <= v1)
        .map((m) => (
          <button
            key={m.id}
            type="button"
            className={
              markerPlace === "low"
                ? "waveform-marker waveform-marker--low"
                : "waveform-marker"
            }
            // The pin follows the pointer from LOCAL state while dragged, or it would lag the hand by a save.
            style={{
              left: timeToX(
                markerDrag?.id === m.id ? markerDrag.atSec : m.atSec,
              ),
            }}
            title={
              onMarkerMove
                ? (m.comment ?? "Marker — drag to move")
                : m.comment || "Marker"
            }
            onPointerDown={(e) => {
              if (!onMarkerMove) return;
              e.stopPropagation(); // …or the canvas underneath starts a selection at the same time
              e.currentTarget.setPointerCapture(e.pointerId);
              setMarkerDrag({ id: m.id, atSec: m.atSec, moved: false });
            }}
            onPointerMove={(e) => {
              if (!markerDrag || markerDrag.id !== m.id) return;
              const x = localX(e.clientX);
              setMarkerDrag({
                id: m.id,
                atSec: Math.max(0, Math.min(total, xToTime(x))),
                // 4px, the same threshold the canvas uses to tell a click from a drag.
                moved: markerDrag.moved || Math.abs(x - timeToX(m.atSec)) > 4,
              });
            }}
            onPointerUp={() => {
              const d = markerDrag;
              setMarkerDrag(null);
              if (!d || d.id !== m.id) return;
              if (d.moved) onMarkerMove?.(m, d.atSec);
              else if (onMarkerClick) onMarkerClick(m);
              else onSeek?.(m.atSec);
            }}
            onPointerCancel={() => setMarkerDrag(null)}
            // Click still answers for a host that offers no move; a drag that handled the release never reaches it.
            onClick={() => {
              if (onMarkerMove) return;
              if (onMarkerClick) onMarkerClick(m);
              else onSeek?.(m.atSec);
            }}
          >
            <span className="waveform-marker-flag">🚩</span>
          </button>
        ))}
    </div>
  );
}

/** Memoised, which is worth nothing unless the host holds its props' identity — see docs/layers.md. */
export const Waveform = memo(WaveformInner);
