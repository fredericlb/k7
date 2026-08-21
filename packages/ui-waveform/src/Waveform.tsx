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
  /**
   * The span of the material to SHOW, in seconds. Absent ⇒ all of it, as it always was.
   *
   * A window rather than a zoom factor, because what a host wants to say is "these twelve bars",
   * not "×3.7". Everything crossing this boundary stays in ABSOLUTE seconds — a view is a way of
   * looking, not a change of units — so a marker's time, a selection and every callback mean the
   * same thing whether or not anything is zoomed.
   */
  view?: { start: number; end: number };
  /**
   * Where a marker sits: a tab hanging from the TOP (the default, as it always was), or a small
   * bubble near the foot of its own line.
   *
   * `low` is for ONSETS. The top of a waveform is where the loud material is, so a row of tabs
   * along the top edge covers the very transients it points at. Opt-in rather than a change of
   * default, because three surfaces draw markers here and only one of them draws onsets — the DJ
   * desk's cues and k7's session marks are neither, and moving them was nobody's request.
   */
  markerPlace?: "top" | "low";
  /**
   * A clip's STRETCH points, in the same display seconds as everything else here: `orig` is the
   * moment of the source, `target` is where that moment's beat lands. Equal means unstretched
   * there. Empty ⇒ nothing drawn, which is every clip that has no map.
   */
  warps?: { orig: number; target: number }[];
  /**
   * Onsets to draw as plain rules, in seconds — reference material, not something to grab.
   *
   * The same times `markers` carries as pins, in the form a host wants when they are the
   * BACKDROP rather than the subject: placing a stretch point means dropping a beat onto a hit,
   * so the hits have to be visible while the warp marks are what the hand is on.
   *
   * Solid, deliberately, though the note on `gridLines` below says solid means "a thing you can
   * act on". These are things — located events the detector found — and not a regular grid; the
   * grammar that matters here is dashed = derived rule, solid = measured moment.
   */
  onsets?: number[];
  /**
   * The material's own window — the span of the source this clip IS — in the same display seconds
   * as everything else here.
   *
   * Drawn as GROUND, under the envelope: it is what the picture is about rather than a mark on it,
   * and it is typically most of the pane, so an overlay tint would wash the waveform it is meant
   * to frame. Absent ⇒ the picture already IS the window, which is every placed clip.
   *
   * `sourceWindow` and not `window`: a prop of that name shadows the global one inside this
   * component, which listens on it.
   */
  sourceWindow?: { from: number; to: number } | null;
  gridLines?: WaveformGrid[]; // optional bar/beat overlay
  height?: number; // canvas height in px; defaults to DEFAULT_HEIGHT
  currentTime: number;
  selection?: Selection | null;
  onSeek?: (sec: number) => void;
  onSelect?: (sel: Selection) => void;
  // Clicking a marker pin seeks to it by default; the host can override (e.g. to
  // also scroll its row into view).
  onMarkerClick?: (marker: Marker) => void;
  /**
   * Drag a marker to another time. Absent ⇒ the pins are click-only, as they were.
   *
   * A pin is a DOM button, so the drag lives on the pin rather than in the canvas's pointer
   * handling: grabbing one must not also start a selection underneath, and the two would race for
   * the same pointer. It is committed on RELEASE — an onset written on every pointermove would be
   * a file write per pixel — while `dragging` below moves the pin as you go, so the hand and the
   * mark stay together. A drag that does not move is a click, and reaches `onMarkerClick`.
   */
  onMarkerMove?: (marker: Marker, toSec: number) => void;
  /**
   * Drag the `sourceWindow`'s two edges. Absent ⇒ the band is drawn and cannot be touched.
   *
   * The edges live HERE, on the canvas, and not on a layer the host puts over it: `timeToX` is the
   * one authoritative mapping — it already carries the view's zoom and the measured width — and a
   * second `(sec - v0) / span` computed outside is exactly how a handle comes to sit a pixel off
   * the line it is supposed to be holding. The pins beside them are placed the same way.
   *
   * Committed on RELEASE, like a marker's move: an edge written on every pointermove would be a
   * file write per pixel, while the band follows the hand from local state meanwhile.
   */
  onWindowMove?: (win: { from: number; to: number }) => void;
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
/**
 * How much of the contour's ink the PEAK curve behind it gets.
 *
 * Low enough that the RMS stays the shape being read, high enough that the top of the peak is
 * findable against the grid — which is the whole point of drawing it: a clip normalised to
 * −1 dBFS has to look normalised. See `Envelope.peak`.
 */
const PEAK_ALPHA = 0.45;

// Stable defaults: a fresh `[]` per render is a new identity, which fired the draw effect on
// EVERY render of the host, playhead frame or not.
const NO_EVENTS: DetectedEvent[] = [];
const NO_ANNOTATIONS: Annotation[] = [];
const NO_MARKERS: Marker[] = [];
const NO_GRID: WaveformGrid[] = [];
const NO_WARPS: { orig: number; target: number }[] = [];
const NO_ONSETS: number[] = [];

const ampToDb = (amp: number): number =>
  amp > 0 ? 20 * Math.log10(amp) : MIN_DB;

// The dB scale, absolute: MIN_DB at the bottom, 0 dB (full scale) at the top. Both envelopes are
// linear where 1.0 == full scale — RMS in `samples`, and the true peak in `peak` when the host
// has one. Which is why the grid can be read: the peak curve's top IS the file's peak.
const dbToYIn = (db: number, h: number): number => {
  const norm = Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB));
  return h - norm * h;
};

/**
 * One y per pixel column for one envelope: interpolate when zoomed in, average when zoomed out.
 *
 * A smoothing pass over every sample, then a pass over every pixel — neither of which depends on
 * the transport, which is why they live here and not in the effect the playhead drives.
 *
 * A free function rather than the body of a memo because it is run TWICE now, once for the RMS
 * contour and once for the peak behind it, and the two must be reduced the same way: two
 * curves on one axis that disagreed about how they got there would be worse than one.
 */
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
  // The pin being dragged, where it is now, and whether it has actually travelled — `moved` is
  // what tells a move from a click, so a mark you meant to remove is not silently re-placed.
  const [markerDrag, setMarkerDrag] = useState<{
    id: string;
    atSec: number;
    moved: boolean;
  } | null>(null);
  // The window edge being dragged, with the pair it makes — so the band resizes under the hand
  // rather than after the write. Null when nothing is being held.
  const [winDrag, setWinDrag] = useState<{
    edge: "from" | "to";
    from: number;
    to: number;
  } | null>(null);
  // Which edge of the editing moment is being dragged, if any.
  const editDrag = useRef<"start" | "end" | null>(null);

  /**
   * Track the container's width, so the canvas is responsive.
   *
   * MEASURED SYNCHRONOUSLY FIRST, in a layout effect, and only then observed. The observer alone
   * left the first paint drawn at the `useState` guess — a canvas sized in px, so a box wider than
   * the guess showed the wave stopping short of its own frame. Invisible on a component that
   * mounts once with the pane; plainly wrong on one that REMOUNTS, which is what st0's clip panel
   * does after a take: `lecture de la prise…` replaces the waveform while the file is fetched, so
   * the picture that comes back is a fresh mount starting from the guess again.
   *
   * A zero is IGNORED rather than floored to 1. A box measured before layout, or while its pane is
   * `hidden`, reports nothing — and a pane that never changes size afterwards never fires the
   * observer a second time, so flooring it would latch a one-pixel canvas for as long as the panel
   * stays open. Keeping the last real width is wrong for at most one resize; latching is forever.
   *
   * No floor besides that: a floor wider than the box is a canvas drawn wider than it is shown,
   * and the marker pins do not follow that stretch. A narrow pane gets a narrow waveform, which is
   * simply what it has room for.
   */
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

  // The effective canvas height (prop, or the default). Aliased so all the drawing
  // below reads it as a plain HEIGHT, whether it fits a pane or uses the default.
  const HEIGHT = height;

  const total =
    duration || (envelope.samples.length * envelope.intervalMs) / 1000;
  // The visible span. Absent ⇒ the whole material, which is what every caller got before there was
  // a window at all. Everything a host hands in or gets back stays in ABSOLUTE seconds — a view is
  // a way of looking, not a change of units, so a marker's time means the same zoomed or not.
  const v0 = view ? Math.max(0, Math.min(view.start, total)) : 0;
  const v1 = view ? Math.max(v0, Math.min(view.end, total)) : total;
  const span = v1 > v0 ? v1 - v0 : total;
  const timeToX = (t: number) => (span > 0 ? ((t - v0) / span) * width : 0);
  const xToTime = (x: number) => (width > 0 ? v0 + (x / width) * span : v0);

  /**
   * The lines BETWEEN the ones the host sent, once the zoom has opened its columns past
   * `MAX_COLUMN_PX` — the ruler over this canvas subdivides at exactly that width, and a wave
   * still ruled in whole beats under a ruler ticking sixteenths reads as two different grids.
   *
   * Derived here rather than in the draw effect because the CLICK wants them too: snapping is to
   * the list that was drawn (docs/ticks.md), so a line you can see and cannot land on would break
   * the one guarantee this grid makes.
   */
  const subGrid = useMemo(
    () =>
      subdivideGrid(
        gridLines.map((g) => g.t),
        span > 0 ? width / span : 0,
      ),
    [gridLines, width, span],
  );
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
  const ys = useMemo(
    () => contourYs(samples, intervalMs, width, v0, span, HEIGHT),
    [samples, intervalMs, width, v0, span, HEIGHT],
  );
  /**
   * …and the same again for the PEAK, when the host has one. Null when it has not, which is
   * every host but st0's clip pane — see `Envelope.peak`.
   */
  const peakYs = useMemo(
    () =>
      envelope.peak?.length
        ? contourYs(envelope.peak, intervalMs, width, v0, span, HEIGHT)
        : null,
    [envelope.peak, intervalMs, width, v0, span, HEIGHT],
  );

  // The two contours, rasterised once each. The DPR is read here rather than tracked: a screen
  // change without a resize leaves them scaled until the next one, which is the cheap trade.
  const layers = useMemo(() => {
    const dpr = window.devicePixelRatio || 1;
    return {
      unplayed: envelopeLayer(ys, width, HEIGHT, dpr, ENV_UNPLAYED),
      played: envelopeLayer(ys, width, HEIGHT, dpr, ENV_PLAYED),
      // The peak behind it, in the same two colours so the progress fill still reads as one
      // picture, and faint enough that the RMS stays the shape the eye follows.
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
    // Only when it actually changed. Assigning `width` — even the value it already holds —
    // reallocates the backing store and resets the whole context, and this effect runs on every
    // engine frame because `currentTime` is in its dependency list. Twenty throwaway
    // reallocations a second, for a box whose size moves when the window does.
    const w = Math.round(width * dpr);
    const h = Math.round(HEIGHT * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    // What the resize used to reset for free, now asserted: the transform here, and every style
    // below set before it is used. The three `setLineDash` calls each restore `[]` — keep it that way.
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
    // The subdivisions first, so a beat's own line wins where the two round to one pixel. Fainter
    // again than a beat — the same three-weight rhythm the ruler above draws.
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

    // The material's window, as GROUND — the span the clip is, lit under everything else, with its
    // two edges picked out so a `from` sitting on silence is still findable. Deliberately colourless:
    // this pane already spends violet on a selection, blue on a warp, teal on a marker, amber and
    // green on regions, and a seventh hue for the thing all of those sit INSIDE would compete with
    // every one of them.
    // The dragged pair while an edge is held: the band has to follow the hand, not the write.
    const shown = winDrag ?? sourceWindow;
    if (shown && shown.to > shown.from) {
      const wx0 = timeToX(shown.from);
      const wx1 = timeToX(shown.to);
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(wx0, 0, Math.max(1, wx1 - wx0), HEIGHT);
      // The EDGES carry it, not the wash: the envelope's own fill is a gradient up to 22% drawn on
      // top, so a band relying on its tint alone reads as a smudge exactly where there is audio.
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

    // Unplayed portion in grey; played portion (left of playhead) in the accent purple — the
    // SoundCloud-style progress fill. All pre-rasterised, so a frame costs blits rather than
    // traced contours, and the draw ORDER is unchanged: everything below still lands on top.
    //
    // The PEAK goes down first, so the RMS sits inside it — which is the whole grammar of the
    // picture: the faint outline is how loud the material gets, the solid one how loud it IS.
    // Both take the same playhead clip, or the progress fill would stop at two different places.
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

    // Onsets as rules — ABOVE the envelope, below the stretch points. Under the envelope (where
    // the grid sits) they would vanish exactly where the material is loud, which is where the
    // hits are.
    ctx.strokeStyle = "rgba(203,213,225,0.5)";
    ctx.lineWidth = 1;
    for (const t of onsets) {
      const ox = Math.round(timeToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, HEIGHT);
      ctx.stroke();
    }

    // Stretch points: a dashed rule where the SOURCE moment is, a solid blue one where its beat
    // lands, and a connector between them when they differ. Drawn HERE rather than as an overlay
    // div because `timeToX` is the one authoritative mapping — an absolutely positioned layer over
    // the canvas has to reproduce it, and a border or a rounding then puts the two a pixel apart.
    for (const w of warps) {
      const ox = Math.round(timeToX(w.orig)) + 0.5;
      const tx = Math.round(timeToX(w.target)) + 0.5;
      ctx.strokeStyle = "rgba(235,235,242,0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgb(96,165,250)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, HEIGHT);
      ctx.stroke();
      if (Math.abs(tx - ox) > 2) {
        ctx.beginPath();
        ctx.moveTo(ox, 12);
        ctx.lineTo(tx, 12);
        ctx.stroke();
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
    subGrid,
    currentTime,
    selection,
    dragSel,
    editing,
    total,
    // Both were missing: the draw survived only because every change to them arrives with a fresh
    // envelope, which invalidates `layers` and redraws anyway. That is a coincidence of the fetch,
    // not a rule, and it would go quiet the first time one of them was set from local state.
    warps,
    onsets,
    sourceWindow,
    winDrag,
  ]);

  // The grid's times alone — what a click snaps to (see nearestTick). The subdivisions are in
  // it: they are drawn, and the rule is that you can only land on a line that is on screen.
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
        /**
         * Sized in PIXELS, not `100%`.
         *
         * Every x the drawing computes uses `width` — the measured one — and the DOM marker pins
         * beside it are placed with the same number. Letting CSS stretch the canvas to some OTHER
         * width scales the drawing and leaves the pins where they were: a teal line and its flag
         * then disagree by however far the two widths differ. `Math.max(200, …)` in the measure
         * below guaranteed exactly that in any pane narrower than 200px.
         *
         * Sizing it explicitly makes the canvas's coordinate space and its box one thing, so the
         * two cannot drift.
         */
        style={{ width, height: HEIGHT, cursor: "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          editDrag.current = null;
          setDragSel(null);
        }}
      />
      {/* The window's two EDGES, when the host offers the move. Same layer as the pins and the
          same `timeToX`, so a handle cannot drift from the line it holds. A 12px grab zone
          straddling the edge: the line itself is 1.5px, which is not a thing a hand can catch. */}
      {onWindowMove &&
        sourceWindow &&
        sourceWindow.to > sourceWindow.from &&
        (["from", "to"] as const).map((edge) => {
          const at = (winDrag ?? sourceWindow)[edge];
          return (
            <button
              key={edge}
              type="button"
              className="waveform-edge"
              style={{ left: timeToX(at), height: HEIGHT }}
              title={`Drag to set the event's ${edge} (${at.toFixed(3)}s)`}
              aria-label={`window ${edge}`}
              onPointerDown={(e) => {
                e.stopPropagation(); // …or the canvas starts a selection under the same finger
                e.currentTarget.setPointerCapture(e.pointerId);
                setWinDrag({ edge, ...sourceWindow });
              }}
              onPointerMove={(e) => {
                if (winDrag?.edge !== edge) return;
                // Clamped to the FILE, and kept a hair apart: a window that crossed itself is not
                // a narrower window, it is one that plays nothing.
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
      {/* Only the pins inside the window. Their `left` is absolute px, so one outside would sit
          off the canvas rather than be clipped by it — a flag hanging in the panel's chrome. */}
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
            // The pin follows the pointer while it is being dragged, and sits at its own time
            // otherwise. Local state, not the prop: the file is written on release, and a pin that
            // waited for that round trip would lag the hand by a save.
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
                // 4px, the same threshold the canvas uses to tell a click from a drag — so a twitch
                // while clicking a mark still removes it rather than moving it onto itself.
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
            // Click still answers for a host that offers no move — and does NOT fire when a drag
            // already handled the release, since that path never reaches a click.
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

/**
 * Memoised, because the host that draws it under a clip editor re-renders on things this
 * component does not care about. Its props must be stable for that to bite: an inline
 * `envelope={{…}}` or a fresh `events={[]}` defeats it — see the module-level defaults above.
 */
export const Waveform = memo(WaveformInner);
