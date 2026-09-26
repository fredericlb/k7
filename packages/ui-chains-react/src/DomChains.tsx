// DomChains.tsx — the Chains routing graph: HTML nodes over a canvas of signal cables,
// with an SVG layer between them for the labels, the arrows and the hit paths.
// It consumes a laid-out graph (dagre owns the layout); only the DRAWING is React, which
// buys real type, CSS effects and a DOM a test can read.
// Shared by the Chains tab and the Graph panel — mount it only where it has a
// real size, since fit() frames to the host. See docs/chainsGraph.md.

// The one icon this file draws from a set: the freeze badge, a snowflake being no CSS shape.
import { Play, Snowflake, Square } from "@frediverse/ui/icons";
import type { WaveformEnvelope } from "@studio/engine-browser";
import {
  PluginParamsStore,
  usePluginParamValue,
} from "@studio/engine-browser/params";
import {
  EngineStore,
  EngineStoreProvider,
  useEngineStoreOrNull,
  useInputLevel,
  useTrackLevel,
} from "@studio/engine-browser/store";
import type { RecorderState } from "@studio/engine-protocol";
import type {
  WebCc,
  WebModuleCategory,
  WebSignal,
  WebWidget,
} from "@studio/graph-model";
import {
  AUTO_ARROW,
  AUTO_DASH,
  AUTO_SHADOW_W,
  AUTO_W,
  type CableDraw,
  drawCables,
  FOREIGN_ALPHA,
  newScratch,
  WOBBLE_FPS,
  WOBBLE_HZ,
  WOBBLE_MAX_SAMPLES,
  WOBBLE_STEP,
} from "@studio/ui-chains/cableCanvas";
import {
  type AutoTarget,
  autoTarget,
  buildCableGeom,
  type CableGeom,
  computeFlow,
  insertFor,
  jackRef,
  type LaneSpan,
  liveVideoLanes,
  midByArc,
  smoothPath,
} from "@studio/ui-chains/cables";
import { decimate } from "@studio/ui-chains/decimate";
import {
  type LaneSource,
  type NodeFlow,
  seedFlows,
  seedsEq,
} from "@studio/ui-chains/flow";
import {
  CLIP_LIST_MAX,
  cablePath,
  type EdgeInsert,
  eventPoint,
  type GraphEdge,
  type GraphNode,
  headerFontPx,
  type Jack,
  jackPoint,
  type LaidOutGraph,
  moduleDisplayName,
  projectBindField,
  type RecVerb,
  rackBindSymbol,
  recBindVerb,
  type TrackControlValues,
  widgetDenorm,
  widgetNorm,
  widgetRect,
} from "@studio/ui-chains/graph";
import {
  type CableSway,
  exciteSway,
  hangPoints,
  newSway,
  stepSway,
} from "@studio/ui-chains/hang";
import { type LaneNotes, noteLoadAt } from "@studio/ui-chains/noteLoad";
import { patchAct } from "@studio/ui-chains/patchGesture";
import { type TakeReadout, takeReadout } from "@studio/ui-chains/takeClock";
import { pinchFactor, spreadOf } from "@studio/ui-chains/zoomGesture";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  applyCam,
  approach,
  type Cam,
  clampZoom,
  frameOriginX,
  isMouseWheel,
  isZoomWheel,
  type Lod,
  lodFor,
  sameLod,
  wheelFactor,
  wheelPixels,
  zoomAbout,
} from "./camera";
import { CTRL, cableColorFor, MAUVE, RING, SAND, useCss } from "./chainsCss";
import { moduleFieldValue, projectFieldValue } from "./moduleField";
import {
  advanceMotion,
  type Ghost,
  type Motion,
  motionPos,
  motionTransform,
  planMotion,
} from "./nodeMotion";

/** A play button on the SINK node, opt-in and absent by default — docs/hosting.md. */
export interface SinkPlay {
  playing: boolean;
  /** No engine, or nothing to play. `title` is what says which. */
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

export type GraphMenuCtx =
  | { kind: "track"; id: string }
  | { kind: "module"; id: string; missing?: boolean; model?: boolean }
  | { kind: "chain"; id: string }
  | { kind: "sink"; id: string }
  // A BOX right-clicked: the instance, and the template behind it — a host may offer either.
  | { kind: "assembly"; id: string; uses: string }
  // One WIDGET right-clicked: the param it drives, and the CC already mapped to it.
  | {
      kind: "param";
      /** The module the widget is drawn on. */
      id: string;
      /** The widget's `bind`, verbatim — `Cutoff`, or `@monitor` for a module field. */
      param: string;
      /** Its label, for a menu that reads as the knob does. */
      label: string;
      /** The CC bound to it today, if any (the module's `controller.yaml`). */
      cc?: WebCc;
    };

/** The glyphs a node draws itself with, supplied by the host — docs/hosting.md. */
export interface ChainsIcons {
  ModuleIcon: (props: {
    category?: WebModuleCategory;
    missing?: boolean;
    className?: string;
    style?: React.CSSProperties;
  }) => React.ReactNode;
  /** Whether a category HAS a glyph, so a node knows to leave room for one. */
  moduleGlyph: (category?: WebModuleCategory, missing?: boolean) => unknown;
  TrackIcon: (props: {
    name: string;
    video?: boolean;
    color?: string;
    className?: string;
    style?: React.CSSProperties;
  }) => React.ReactNode;
  /**
   * A track's name WITHOUT the instrument code its glyph was picked from — `ge.rythm-machine` reads
   * `rythm-machine`, the prefix being said by the icon already. The host's, like the glyphs: which
   * codes exist is `@studio/song-schema`'s table, and drawing a graph must not drag that in.
   */
  trackLabel?: (name: string) => string;
}

// Carried by context, not by props, and provided by DomChains itself — docs/hosting.md.
const IconsContext = createContext<ChainsIcons | null>(null);

function useIcons(): ChainsIcons {
  const v = useContext(IconsContext);
  if (!v) throw new Error("DomChains rendered without its icons");
  return v;
}

// A shared, never-updated store for a graph without live params, so the hook stays unconditional.
const EMPTY_PARAMS_STORE = new PluginParamsStore();

// The PALETTE lives in `chainsCss.ts` with the stylesheet, and is re-imported here for the canvas.

// A stable empty track order: a fresh `[]` per render would change every Node's props each frame.
const EMPTY_ORDER: string[] = [];
// The same for "no cable carries signal" — never mutated, always replaced.
const EMPTY_LIVE: Map<string, number> = new Map();
const EMPTY_SEEDS: Map<string, NodeFlow> = new Map();
// …and for "nothing is leaving", so settling twice does not re-render the graph twice.
const EMPTY_GHOSTS: Ghost<GraphNode>[] = [];
// A cable drawn mid-move is drawn STILL — docs/nodeMotion.md.
const NO_SAMPLES: CableGeom["samples"] = [];

const DRAG_SLOP = 4; // px of movement before a press becomes a pan (so a pan never selects)
const DRAG_TRAVEL_PX = 150; // screen px of vertical drag that sweep a control's whole range
const DRAG_FINE = 0.25; // shift-held multiplier for a fine adjustment

// The stylesheet — 415 lines, scoped to `.dgx` — is `chainsCss.ts`, with the hook that injects it.

// --- widget targeting + value resolution (ports render.ts's widgetTarget/widgetValue) --

type TrackControl = keyof TrackControlValues;
type WidgetTarget =
  | { kind: "plugin"; pluginId: string; name: string }
  | { kind: "track"; trackId: string; control: TrackControl }
  | { kind: "module"; module: string; field: string }
  // A param of a module realised OUTSIDE the graph — see `offlineOf`.
  | { kind: "offline"; module: string; name: string }
  // A RACK's pad — the one target that SETS nothing, docs/widgets.md.
  | { kind: "rack"; module: string; symbol: string }
  // …and a RECORDER's button, the second of that family — engine/st0-engine/docs/recorder.md.
  | { kind: "recorder"; module: string; verb: RecVerb; pluginId?: string }
  // …and a PROJECT setting: read off the card like a field, WRITTEN by a verb (docs/widgets.md).
  | { kind: "project"; field: string };

/** What a widget actuates: a pad, an `@` intrinsic, a plugin param, else offline — docs/widgets.md. */
function widgetTarget(
  n: GraphNode,
  w: WebWidget,
  /** Does the host offer a channel for modules with no plugin? See `offlineOf`. */
  offline = false,
): WidgetTarget | null {
  if (!w.bind) return null;
  // A PROMOTED param is a shortcut and nothing else: it resolves to the member's own param, and is
  // then read, written and committed by exactly the arms below. See packages/song/docs/assemblies.md.
  const promoted = n.assemblyOf?.params?.[w.bind];
  if (promoted)
    return promoted.pluginId
      ? { kind: "plugin", pluginId: promoted.pluginId, name: promoted.param }
      : { kind: "offline", module: promoted.node, name: promoted.param };
  // A rack pad, before the general `@` case: an intrinsic that FIRES rather than sets.
  const symbol = rackBindSymbol(w.bind);
  if (symbol)
    return n.module ? { kind: "rack", module: n.module, symbol } : null;
  // …and a recorder's, for the same reason and with the same urgency: reaching the arm below,
  // `@rec:record` would resolve to a FIELD called "rec:record" and the button would write it.
  const verb = recBindVerb(w.bind);
  if (verb)
    return n.module
      ? { kind: "recorder", module: n.module, verb, pluginId: n.pluginId }
      : null;
  // …and a PROJECT setting, before the general `@` arm for the reason the two above are: what it
  // sets lives in project.yaml, and `@project:aspect` would become a FIELD called "project:aspect".
  const setting = projectBindField(w.bind);
  if (setting) return { kind: "project", field: setting };
  if (w.bind.startsWith("@")) {
    const field = w.bind.slice(1);
    if (n.kind === "track")
      return {
        kind: "track",
        trackId: n.label,
        control: field as TrackControl,
      };
    return n.module ? { kind: "module", module: n.module, field } : null;
  }
  if (n.pluginId) return { kind: "plugin", pluginId: n.pluginId, name: w.bind };
  // No plugin, and the host says it knows what such a module is set to — opt-in, docs/widgets.md.
  return offline && n.module
    ? { kind: "offline", module: n.module, name: w.bind }
    : null;
}

// Is any optimistic value outstanding on this channel? The guard that keeps a frame free when none is.
function hasChannel(o: Record<string, number>, prefix: string): boolean {
  for (const key in o) if (key.startsWith(prefix)) return true;
  return false;
}

/** The override map with one channel dropped — the SAME object when it dropped nothing, docs/widgets.md. */
function dropChannel(
  o: Record<string, number>,
  prefix: string,
  under: string | undefined,
): Record<string, number> {
  let dropped = false;
  const keep: Record<string, number> = {};
  for (const key in o) {
    if (key.startsWith(prefix) && key !== under) dropped = true;
    else keep[key] = o[key];
  }
  return dropped ? keep : o;
}

// The override map's key: an optimistic value that outranks the incoming frame until that frame catches up.
function targetKey(t: WidgetTarget): string {
  if (t.kind === "track") return `t:${t.trackId}:${t.control}`;
  if (t.kind === "module") return `m:${t.module}:${t.field}`;
  // A recorder's button holds no value: the state frame says whether it is rolling, at 20 Hz.
  if (t.kind === "recorder") return `r:${t.module}:${t.verb}`;
  if (t.kind === "project") return `p:${t.field}`;
  if (t.kind === "offline") return `o:${t.module}:${t.name}`;
  // A pad holds no value, so nothing ever writes under this key — it only covers the union.
  if (t.kind === "rack") return `r:${t.module}:${t.symbol}`;
  return `p:${t.pluginId}:${t.name}`;
}

/** A module field's current value as a WIDGET number, through the widget's own options — docs/widgets.md. */
/** Where a host parks the camera between mounts — `Cam` itself lives in camera.ts, docs/hosting.md. */
export type { Cam };
export type CamStore = React.MutableRefObject<Cam | null>;

interface Channels {
  // The STORE, not its map, so one plugin's frame re-renders one control — engine-browser's docs/params.md.
  params: PluginParamsStore;
  trackControls: Record<string, TrackControlValues>;
  override: Record<string, number>;
  // The engine's `levels` arrive by POSITION, so metering anything needs the order to name them.
  trackOrder: string[];
  // A module the compiler emits NO plugin for — see `moduleParams` on the props.
  moduleParams: Record<string, Record<string, number>>;
  // Does the host handle those at all? An EMPTY map is a legitimate state — docs/hosting.md.
  offlineChannel: boolean;
  // …and can it TAKE one back? Showing without taking is legitimate — docs/hosting.md.
  offlineWritable: boolean;
  // The same question for the other two channels, asked separately since they answer separately.
  pluginWritable: boolean;
  trackWritable: boolean;
  // …and for a RACK pad, which asks for a sound rather than a value: can this host make one?
  rackTriggerable: boolean;
  // …and whether one can drive a RECORDER: a card with no engine behind it draws inert buttons
  // rather than buttons that do nothing — engine/st0-engine/docs/recorder.md.
  recorderWired: boolean;
  projectWritable: boolean;
  // Is this graph a REHEARSAL — there is nowhere to send a value and none is needed.
  rehearsal: boolean;
  /** Which rack sounds are firing right now — a STORE, subscribed per pad. See `RackLitStore`. */
  rackLit?: RackLitStore;
}

/** Which rack sounds are firing, as a pad asks it: one module, one note — docs/widgets.md. */
export interface RackLitStore {
  subscribeTo(module: string, cb: () => void): () => void;
  isLit(module: string, note: number): boolean;
}

/** One pad's lit state — a null module or note is "nothing to watch", so the hook stays unconditional. */
function useRackLit(
  store: RackLitStore | undefined,
  module: string | null,
  note: number | null,
): boolean {
  const subscribe = useCallback(
    (cb: () => void) =>
      store && module ? store.subscribeTo(module, cb) : () => {},
    [store, module],
  );
  const read = useCallback(
    () => (store && module && note != null ? store.isLit(module, note) : false),
    [store, module, note],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/** One recorder node's state off the store — subscribed HERE rather than passed as a prop, for
 *  the reason liveCables.md gives: a 20 Hz frame must not re-render three thousand lines of hooks
 *  to move one light. Null module is "nothing to watch", so the hook stays unconditional. */
function useRecorderState(
  store: EngineStore | null,
  node: string | null,
): RecorderState | undefined {
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribe(cb) : () => {}),
    [store],
  );
  const read = useCallback(
    () => (store && node ? store.getSnapshot().recorders?.[node] : undefined),
    [store, node],
  );
  return useSyncExternalStore(subscribe, read, read);
}

const NO_READOUT: TakeReadout = {};

/** What a recorder card draws over (or instead of) its waveform. Subscribed as its own slice and
 *  compared on the TEXT, so a 20 Hz frame re-renders the card only when the clock ticks over. */
function useTakeReadout(
  store: EngineStore | null,
  node: string | null,
): TakeReadout {
  const cache = useRef<TakeReadout>(NO_READOUT);
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribe(cb) : () => {}),
    [store],
  );
  const read = useCallback(() => {
    if (!store || !node) return NO_READOUT;
    const next = takeReadout(store.getSnapshot().recorders?.[node]);
    const had = cache.current;
    if (next.message === had.message && next.elapsed === had.elapsed)
      return had;
    cache.current = next;
    return next;
  }, [store, node]);
  return useSyncExternalStore(subscribe, read, read);
}

/** The value a widget shows: override, else engine, else authored, else nothing — docs/widgets.md. */
function widgetValue(
  n: GraphNode,
  w: WebWidget,
  ch: Channels,
  live?: number,
): number | undefined {
  const tgt = widgetTarget(n, w, ch.offlineChannel);
  if (!tgt) return undefined;
  // A pad has no value to show; whether it is LIT is `useRackLit`'s separate question.
  if (tgt.kind === "rack") return undefined;
  // …nor has a recorder's button: the record light comes off the state frame, not off a value.
  if (tgt.kind === "recorder") return undefined;
  // A project setting reads off the CARD, which `buildGraph` put the host's answer on.
  if (tgt.kind === "project") return projectFieldValue(n, tgt.field);
  const key = targetKey(tgt);
  if (key in ch.override) return ch.override[key];
  const v =
    tgt.kind === "track"
      ? ch.trackControls[tgt.trackId]?.[tgt.control]
      : tgt.kind === "module"
        ? moduleFieldValue(n, w, tgt.field)
        : tgt.kind === "offline"
          ? // What the SURFACE that realises it says, else what the file authored. There is no
            // engine answer to fall back on: the compiler emitted no plugin to ask.
            (ch.moduleParams[tgt.module]?.[tgt.name] ?? n.params?.[tgt.name])
          : (live ??
            ch.params.getSnapshot()[tgt.pluginId]?.[tgt.name] ??
            n.params?.[tgt.name]);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const draggable = (w: WebWidget) =>
  w.type === "knob" ||
  w.type === "slider" ||
  w.type === "fader" ||
  w.type === "number";

function fmtValue(v: number | undefined): string {
  if (v === undefined) return "–";
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

// --- edge geometry (the maths is @studio/ui-chains/cables; here, its per-edge metadata) ---

interface EdgeGeom extends CableGeom {
  id: string;
  source: string;
  target: string;
  label?: string;
  signal?: WebSignal; // what the cable carries — picks its colour (see cableColor)
  /** This cable merely CROSSES an open frame rather than belonging to it — drawn at half. */
  faded?: boolean;
  insert: EdgeInsert | null;
}

// --- controls ----------------------------------------------------------------

// A knob dial as an SVG arc, 0..1, with `text` read in its middle — docs/widgets.md.
function Knob({
  t,
  known,
  size,
  text,
}: {
  t: number;
  known: boolean;
  size: number;
  text?: string;
}) {
  const START = Math.PI * 0.75,
    SWEEP = Math.PI * 1.5;
  const c = size / 2;
  const R = c - 2.5;
  const pt = (a: number) => [c + Math.cos(a) * R, c + Math.sin(a) * R];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const a = START + SWEEP * Math.max(0, Math.min(1, t));
  const [ix, iy] = pt(a);
  // The pointer starts here rather than at the centre, leaving the middle to the reading.
  const tickR = R * 0.72;
  const [tx, ty] = [c + Math.cos(a) * tickR, c + Math.sin(a) * tickR];
  const font = Math.max(6, Math.round(size * 0.2));
  // Monospace advance is ~0.6em; the -1 keeps a hair between the last glyph and the pointer.
  const readable = !!text && text.length * 0.6 * font <= 2 * (tickR - 1);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={c - 1} fill="#0e0e12" stroke="#26262d" />
      <path
        d={arc(START, START + SWEEP)}
        fill="none"
        stroke="#2f2f36"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {known && (
        <>
          <path
            d={arc(START, a)}
            fill="none"
            stroke={SAND}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <line
            x1={tx}
            y1={ty}
            x2={ix}
            y2={iy}
            stroke="#e7e6ea"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
      {readable && (
        <text
          x={c}
          y={c}
          textAnchor="middle"
          dominantBaseline="central"
          fill={known ? "#e7e6ea" : "var(--faint)"}
          fontSize={font}
          fontFamily="ui-monospace, monospace"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {text}
        </text>
      )}
    </svg>
  );
}

// A tiny sparkline for a curve node, chosen off its shape sub-label.
function Spark({ sub }: { sub: string }) {
  const W = 54,
    H = 24,
    p = 3,
    n = 48,
    s = sub.toLowerCase();
  const f = (t: number) =>
    s.includes("triangle")
      ? t < 0.5
        ? t * 2
        : 2 - t * 2
      : s.includes("saw")
        ? t
        : s.includes("square")
          ? t < 0.5
            ? 1
            : 0
          : s.includes("custom")
            ? t < 0.25
              ? t * 4
              : t < 0.55
                ? 1
                : t < 0.8
                  ? 1 - (t - 0.55) * 3.2
                  : 0.2
            : (Math.sin(t * Math.PI * 2) + 1) / 2;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return `${(p + t * (W - 2 * p)).toFixed(1)} ${(H - p - f(t) * (H - 2 * p)).toFixed(1)}`;
  });
  const d = "M " + pts.join(" L ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <path
        d={`${d} L ${W - p} ${H - p} L ${p} ${H - p} Z`}
        fill="rgba(168,137,181,.12)"
      />
      <path
        d={d}
        fill="none"
        stroke={MAUVE}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A tabs widget: a tab bar over the active page's sub-widgets. Local state, since Widget itself is stateless.
function TabsWidget({
  n,
  w,
  ch,
  style,
  onDragStart,
  onTap,
  onPick,
  onPickAsset,
  onWatchWaveform,
  onContextParam,
}: {
  n: GraphNode;
  w: WebWidget;
  ch: Channels;
  style: React.CSSProperties;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTap: (n: GraphNode, w: WebWidget) => void;
  onPick: (n: GraphNode, w: WebWidget, value: number) => void;
  /** Open the library browser for this widget, at the click's viewport coords. */
  onPickAsset: (n: GraphNode, param: string, x: number, y: number) => void;
  /** Right-click a sub-widget — passed straight through to each. */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
}) {
  const [activePage, setActivePage] = useState<string | null>(null);
  const pages = w.pages ?? {};
  const pageNames = Object.keys(pages);
  const current = activePage ?? pageNames[0] ?? null;
  const currentWidgets = current ? pages[current] : null;
  const TAB_H = 16; // px for the tab bar

  return (
    // `justifyContent` inline: the bar sits at the TOP, as the `+ TAB_H` offset assumes — docs/widgets.md.
    <div
      className="dgx-w"
      style={{ ...style, justifyContent: "flex-start" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* tab bar */}
      <div
        // `w-full`, because .dgx-w is a centring flex column that would size the bar to its NAMES.
        className="flex w-full overflow-hidden"
        style={{ height: TAB_H, borderBottom: "1px solid #2f2f36" }}
      >
        {pageNames.map((name) => (
          <button
            key={name}
            onClick={(e) => {
              e.stopPropagation();
              setActivePage(name);
            }}
            // `flex-auto`, not `flex-1`: basis is the NAME's width, so the spare space is shared out.
            className="flex-auto truncate px-1 text-center text-[8px] leading-none text-muted-foreground hover:text-foreground"
            style={{
              borderBottom:
                name === current
                  ? "1.5px solid var(--sand)"
                  : "1.5px solid transparent",
              color: name === current ? "#e7e6ea" : undefined,
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {/* sub-widgets of the active page */}
      {currentWidgets &&
        Object.entries(currentWidgets).map(([id, sub]) => {
          const sr = widgetRect(sub);
          return (
            <Widget
              key={id}
              n={n}
              w={sub}
              ch={ch}
              onDragStart={onDragStart}
              onTap={onTap}
              onPick={onPick}
              onPickAsset={onPickAsset}
              onWatchWaveform={onWatchWaveform}
              onContextParam={onContextParam}
              styleOverride={{
                position: "absolute",
                left: sr.x - (style.left as number),
                top: sr.y - (style.top as number) + TAB_H,
                width: sr.w,
                height: sr.h,
              }}
            />
          );
        })}
    </div>
  );
}

// Module-level so "no envelope" is one identity: a fresh [] per read would look like a change every frame.
const NO_ENVELOPE: WaveformEnvelope[] = [];
const NOOP = (): void => {};
const NOOP1 = (_: unknown): void => {};

// Hand a node back to React: the three properties the frame loop writes, and only those.
function clearMotionStyle(el: HTMLElement | undefined): void {
  if (!el) return;
  el.style.transform = "";
  el.style.filter = "";
  el.style.pointerEvents = "";
}

// Are these the same cards on their way out? By id, so re-planning mid-exit does not re-render.
function sameGhosts(
  a: readonly Ghost<GraphNode>[],
  b: readonly Ghost<GraphNode>[],
): boolean {
  return a.length === b.length && a.every((g, i) => g.node.id === b[i].node.id);
}

// A waveform widget: a real-time min/max envelope on a <canvas>, off the frame's waveform map for this module.
function WaveformWidget({
  n,
  w,
  style,
  onWatch,
}: {
  n: GraphNode;
  w: WebWidget;
  style: React.CSSProperties;
  /** Ask the engine to tap this module (or stop). Without it nothing is ever captured. */
  onWatch?: (pluginId: string, side: "input" | "output", on: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // A recorder node draws its TAKE, not a live tap: the whole of it, growing, off the state
  // frame's `recorders` rather than `waveform` — see engine/st0-engine/docs/recorder.md.
  const isTake = w.source === "take";
  // Where to listen: this node's own plugin, or the tap it names — docs/waveformWidget.md.
  const tap = n.tap ?? (n.pluginId ? { id: n.pluginId, side: w.source } : null);
  // The waveform key is pluginId:side (e.g. "chain:module:output").
  const key = isTake
    ? null
    : tap?.id && tap.side
      ? `${tap.id}:${tap.side}`
      : null;
  const takeKey = isTake ? (n.pluginId ?? null) : null;

  // The envelope reaches the canvas through a REF off a RAW subscription — docs/waveformWidget.md.
  const store = useEngineStoreOrNull();
  // …and what a RECORDER's card says: a message when it holds nothing, else the take's clock.
  const readout = useTakeReadout(store, takeKey);
  // The message REPLACES the waveform rather than sitting over it, so the paint is told to stop.
  const blankRef = useRef(false);
  blankRef.current = readout.message !== undefined;
  const envelopeRef = useRef<WaveformEnvelope[]>(NO_ENVELOPE);
  const dirtyRef = useRef(true);
  // Set by the draw effect; the subscription below pokes it to restart a stopped loop.
  const wakeRef = useRef<() => void>(NOOP);

  useEffect(() => {
    if (!store || !key) return;
    // Read on subscribe too, so a widget repointed between two frames drops the previous picture.
    const read = (): void => {
      const env = store.getSnapshot().waveform[key] ?? NO_ENVELOPE;
      if (env === envelopeRef.current) return;
      // A module with no tap sends nothing, and empty-after-empty is not a repaint.
      if (env.length === 0 && envelopeRef.current.length === 0) return;
      envelopeRef.current = env;
      dirtyRef.current = true;
      wakeRef.current();
    };
    read();
    return store.subscribe(read);
  }, [store, key]);

  // …and the take's, which the STORE accumulates rather than this card: the whole picture arrives
  // in ONE frame when the socket connects, a second before this exists (engine-browser's
  // takeEnvelope.ts). Folding it here would miss that frame every time.
  const takeRef = useRef<WaveformEnvelope[]>(NO_ENVELOPE);
  useEffect(() => {
    if (!store || !takeKey) return;
    const read = (): void => {
      const points = store.takeOf(takeKey)?.points ?? NO_ENVELOPE;
      // The store hands back the SAME array while nothing moves, which is most frames.
      if (points === takeRef.current) return;
      takeRef.current = points;
      envelopeRef.current = points;
      dirtyRef.current = true;
      wakeRef.current();
    };
    read();
    return store.subscribe(read);
  }, [store, takeKey]);

  // The tap costs the ENGINE a plugin, so it is placed and removed with this widget —
  // docs/waveformWidget.md. A take needs none: the recorder is already in the chain.
  const id = isTake ? undefined : tap?.id;
  const side = tap?.side === "input" ? "input" : "output";
  useEffect(() => {
    if (!id || !onWatch) return;
    onWatch(id, side, true);
    return () => onWatch(id, side, false);
  }, [id, side, onWatch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The box comes from a ResizeObserver: measuring inside the draw flushes style every frame.
    let W = 0;
    let H = 0;
    let appliedDpr = 0;
    let raf = 0;
    let last = 0;
    const minDt = 1000 / WOBBLE_FPS;

    const paint = (): void => {
      const dpr = window.devicePixelRatio || 1;
      if (
        appliedDpr !== dpr ||
        canvas.width !== W * dpr ||
        canvas.height !== H * dpr
      ) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        // setTransform, not scale: resizing resets the matrix, so scale() would compound.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        appliedDpr = dpr;
      }
      ctx.clearRect(0, 0, W, H);
      // Nothing to show and the card SAYS so — an empty waveform beside those words would read
      // as a broken meter rather than as an idle machine (takeClock.ts).
      if (blankRef.current) return;
      // A take is thousands of points against a card's ~120: decimated keeping the EXTREMES,
      // since averaging them away draws a quiet take (decimate.ts).
      const env = isTake
        ? decimate(envelopeRef.current, Math.max(1, Math.round(W)))
        : envelopeRef.current;
      const mid = H / 2;
      if (env.length === 0) {
        // No data — draw a flat center line.
        ctx.strokeStyle = "rgba(200,160,106,0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(W, mid);
        ctx.stroke();
        return;
      }
      // Fill envelope: min..max → top..bottom (Y axis: 0 = top, H = bottom).
      ctx.fillStyle = "rgba(200,160,106,0.15)";
      ctx.beginPath();
      const step = W / Math.max(1, env.length - 1);
      // Top edge (max → upward from mid)
      for (let i = 0; i < env.length; i++) {
        const x = i * step;
        const y = mid - env[i].max * mid;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Bottom edge (min → downward from mid, reversed)
      for (let i = env.length - 1; i >= 0; i--) {
        const x = i * step;
        const y = mid - env[i].min * mid;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      // Center line (zero crossing)
      ctx.strokeStyle = "rgba(200,160,106,0.35)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();
    };

    // Started by an envelope, stopped by stillness: a silent module schedules no frames at all.
    const tick = (now: number): void => {
      raf = 0;
      if (!dirtyRef.current || W <= 0 || H <= 0) return;
      if (now - last < minDt) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = now;
      dirtyRef.current = false;
      paint();
    };
    const wake = (): void => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      W = box.width;
      H = box.height;
      dirtyRef.current = true;
      wake();
    });
    ro.observe(canvas);
    wake(); // the observer's first callback is async; a mounted widget still owes one paint

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      wakeRef.current = NOOP;
    };
    // `isTake` is read in the draw and is a property of the WIDGET, which does not change under
    // a mounted canvas — the empty list is the loop's own, as docs/waveformWidget.md describes.
  }, [isTake]);

  // The canvas is painted off refs, so the message appearing has to ask for a frame itself.
  const blank = readout.message !== undefined;
  useEffect(() => {
    dirtyRef.current = true;
    wakeRef.current();
  }, [blank]);

  return (
    <div className="dgx-w dgx-wave" style={style}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {readout.message !== undefined && (
        <span className="dgx-wave-msg">{readout.message}</span>
      )}
      {readout.elapsed !== undefined && (
        <span className="dgx-wave-clock">{readout.elapsed}</span>
      )}
    </div>
  );
}

// One widget at its widgetRect box: knob/slider/number drag, toggle/button tap, painted off the override.
function WidgetInner({
  n,
  w,
  ch,
  onDragStart,
  onTap,
  onPick,
  onPickAsset,
  onWatchWaveform,
  onContextParam,
  onLandAutomation,
  styleOverride,
}: {
  n: GraphNode;
  w: WebWidget;
  ch: Channels;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTap: (n: GraphNode, w: WebWidget) => void;
  // A dropdown picks an exact value rather than flipping one, so it can't go through onTap.
  onPick: (n: GraphNode, w: WebWidget, value: number) => void;
  /** Open the library browser for this widget, at the click's viewport coords — it picks a FILE. */
  onPickAsset: (n: GraphNode, param: string, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** Right-click on this control — the host's menu for the PARAM it drives (see GraphMenuCtx). */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  /** A curve's cable is in hand and this widget is a LANDING TARGET — passed only while one is out. */
  onLandAutomation?: (n: GraphNode, w: WebWidget) => void;
  styleOverride?: React.CSSProperties;
}) {
  const r = widgetRect(w);
  // Hoisted above the two delegating returns, since the subscription below is a hook.
  const tgt = widgetTarget(n, w, ch.offlineChannel);
  // This control's own live value: a plugin frame re-renders this widget, not the graph.
  const live = usePluginParamValue(
    ch.params,
    tgt?.kind === "plugin" ? tgt.pluginId : null,
    tgt?.kind === "plugin" ? tgt.name : null,
  );
  // …and a rack pad's own tap, so one sound firing lights one pad rather than the graph.
  const padSymbol = tgt?.kind === "rack" ? tgt.symbol : null;
  const padLit = useRackLit(
    ch.rackLit,
    tgt?.kind === "rack" ? tgt.module : null,
    padSymbol
      ? (n.rack?.find((s) => s.symbol === padSymbol)?.note ?? null)
      : null,
  );

  // …and a RECORDER's, the same way and for the same reason: what lights it is the engine
  // saying it is rolling, never the click, which would light on a refusal too.
  const recNode = tgt?.kind === "recorder" ? (tgt.pluginId ?? null) : null;
  const recState = useRecorderState(useEngineStoreOrNull(), recNode);

  // Tabs widget: delegate to TabsWidget
  if (w.type === "tabs") {
    return (
      <TabsWidget
        n={n}
        w={w}
        ch={ch}
        style={
          styleOverride ?? { left: r.x, top: r.y, width: r.w, height: r.h }
        }
        onDragStart={onDragStart}
        onTap={onTap}
        onPick={onPick}
        onPickAsset={onPickAsset}
        onWatchWaveform={onWatchWaveform}
        onContextParam={onContextParam}
      />
    );
  }

  // Waveform widget: delegate to WaveformWidget
  if (w.type === "waveform") {
    return (
      <WaveformWidget
        n={n}
        w={w}
        onWatch={onWatchWaveform}
        style={
          styleOverride ?? { left: r.x, top: r.y, width: r.w, height: r.h }
        }
      />
    );
  }

  // Read-only where the host gave no way back — honest, where draggable-and-ignored is not.
  const actuable =
    tgt !== null &&
    // A pad needs a host that can make a SOUND, which a rehearsal cannot invent — so it is asked first.
    (tgt.kind === "rack"
      ? ch.rackTriggerable
      : // …and a PROJECT setting needs a host that can run a verb: a preview card is looking at
        // no project, so its dropdown reads and does not write.
        tgt.kind === "project"
        ? ch.projectWritable
        : // …and a recorder's button needs a host wired to the ENGINE, which a rehearsal has not
          // got: a preview card must not start a take in somebody's project.
          tgt.kind === "recorder"
          ? ch.recorderWired
          : // A rehearsal has nowhere to send a value and needs nowhere: the override is the answer.
            ch.rehearsal ||
            (tgt.kind === "offline"
              ? ch.offlineWritable
              : tgt.kind === "track"
                ? ch.trackWritable
                : ch.pluginWritable));
  const value = widgetValue(n, w, ch, live);
  const known = value !== undefined;
  const t = known ? widgetNorm(w, value) : 0;
  const style: React.CSSProperties = styleOverride ?? {
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h,
  };
  const caption =
    w.type === "label" || w.type === "button" ? undefined : w.label;

  // …and where a DROPDOWN's goes — never the library kind, whose body already fills the box.
  const beside =
    w.type === "dropdown" &&
    !w.library &&
    !!caption &&
    captionFitsBeside(caption, w.options ?? [], r.w);

  // A control never selects the node; an inert one (label, meter, undrivable knob) lets the click fall through.
  const interact: React.HTMLAttributes<HTMLDivElement> & { className: string } =
    actuable && draggable(w)
      ? {
          className: "dgx-w drag",
          onPointerDown: (e) => onDragStart(n, w, e),
          onClick: (e) => e.stopPropagation(),
        }
      : w.type === "dropdown" || w.type === "filepicker"
        ? {
            className: "dgx-w",
            onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
          }
        : actuable && (w.type === "toggle" || w.type === "button")
          ? {
              className: "dgx-w tap",
              onClick: (e) => {
                e.stopPropagation();
                onTap(n, w);
              },
            }
          : { className: "dgx-w" };

  // A control that drives something can be right-clicked for what drives IT, and stopped there.
  if (actuable && onContextParam)
    interact.onContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextParam(n, w, e.clientX, e.clientY);
    };

  let body: React.ReactNode = null;
  if (w.type === "knob") {
    const size = Math.min(r.w, r.h - (caption ? 11 : 0)) - 4;
    body = (
      <Knob
        t={t}
        known={known}
        size={Math.max(14, size)}
        text={fmtValue(value)}
      />
    );
  } else if (w.type === "slider") {
    body = (
      <div className="dgx-slider">
        <i style={{ width: `${(known ? t : 0) * 100}%` }} />
      </div>
    );
  } else if (w.type === "fader") {
    // Readout first, then the rail with whatever height is left — see .dgx-fader.
    body = (
      <>
        <span className={`dgx-fval${known ? "" : " unknown"}`}>
          {fmtValue(value)}
        </span>
        <div className={`dgx-fader${known ? "" : " unknown"}`}>
          {/* The VU rides left of the throw, and only on a chain that IS a track. */}
          {n.chain && <FaderMeter trackId={n.chain} order={ch.trackOrder} />}
          <div className="rail">
            <i
              className="fill"
              style={{ height: `${(known ? t : 0) * 100}%` }}
            />
            <i
              className="cap"
              style={{ top: `${(1 - (known ? t : 0)) * 100}%` }}
            />
          </div>
        </div>
      </>
    );
  } else if (w.type === "toggle") {
    const on = known && t >= 0.5;
    body = (
      <div className={`dgx-toggle${on ? " on" : ""}`}>
        <i />
      </div>
    );
  } else if (w.type === "button") {
    // A rack pad has no value, so `t` says nothing about it: what lights it is its own note.
    // A recorder's `record` is the same shape: lit while the ENGINE says it is rolling.
    const on = padSymbol
      ? padLit
      : tgt?.kind === "recorder"
        ? tgt.verb === "record" && (recState?.recording ?? false)
        : known && t >= 0.5;
    const c = (w.bind && CTRL[w.bind]) ?? RING;
    // `clear` and `save` need a take to act on, and `save` needs one that is FINISHED — drawn
    // faint rather than hidden, so the card reads the same whether or not anything is recorded.
    // A take being ROLLING is something `clear` can act on: it stops it and drops it, one press.
    const none =
      (recState?.takes.length ?? 0) === 0 && !(recState?.recording ?? false);
    const idle =
      tgt?.kind === "recorder" &&
      tgt.verb !== "record" &&
      (tgt.verb === "save"
        ? (recState?.takes.length ?? 0) === 0 || (recState?.recording ?? false)
        : none);
    body = (
      <b
        className={`dgx-btn${on ? " on" : ""}${idle ? " unknown" : ""}`}
        style={{ ["--c" as string]: c }}
      >
        {/* A rack PAD draws bare, its symbol left to the tooltip; see docs/widgets.md. */}
        {padSymbol ? "" : (w.label ?? "?")}
      </b>
    );
  } else if (w.type === "number") {
    body = (
      <span className={`dgx-num${known ? "" : " unknown"}`}>
        {fmtValue(value)}
      </span>
    );
  } else if (w.type === "label") {
    body = <span className="dgx-wtext">{w.text ?? ""}</span>;
  } else if (w.type === "meter") {
    body = <div className="dgx-meter" />;
  } else if (w.type === "filepicker" || (w.type === "dropdown" && w.library)) {
    // Picks a FILE the module carries, through a button rather than a <select> — docs/widgets.md.
    const param = String(w.type === "filepicker" ? (w.bind ?? "") : w.library);
    const current = n.assets?.[param] ?? "";
    const shown = current
      ? current.slice(current.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")
      : "—";
    body = (
      <button
        type="button"
        className={`dgx-sel dgx-file${current ? "" : " unknown"}`}
        // The whole path, since the face shows only the basename, which two packs may share.
        title={current || `pick a ${w.library} file`}
        disabled={!n.module}
        onClick={(e) => {
          e.stopPropagation();
          onPickAsset(n, param, e.clientX, e.clientY);
        }}
      >
        {shown}
      </button>
    );
  } else if (w.type === "dropdown") {
    // Options carry their own values, so the current setting is the NEAREST one — a plugin's states aren't evenly spaced.
    const opts = w.options ?? [];
    const cur =
      known && opts.length
        ? opts.reduce((best, o) =>
            Math.abs(o.value - value) < Math.abs(best.value - value) ? o : best,
          ).value
        : undefined;
    body = (
      <select
        className={`dgx-sel${known ? "" : " unknown"}`}
        value={cur ?? ""}
        disabled={!actuable || !opts.length}
        onChange={(e) => onPick(n, w, Number(e.target.value))}
      >
        {/* Only until the first value arrives, so the first option is never shown as the setting. */}
        {cur === undefined && <option value="">—</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  // A curve's cable is in hand and this PLUGIN param can take it — docs/widgets.md.
  const landing = !!onLandAutomation && !!w.bind && !w.bind.startsWith("@");
  if (landing)
    return (
      <div
        className="dgx-w dgx-land"
        style={style}
        title={`bind the curve to ${w.label || w.bind}`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => {
          e.stopPropagation();
          onLandAutomation?.(n, w);
        }}
      >
        {body}
        {caption && <span className="dgx-wlab">{caption}</span>}
      </div>
    );

  return (
    <div
      {...interact}
      style={style}
      // An unlabelled pad has to say what it is somewhere, and only a pad needs the tooltip for it.
      title={padSymbol ?? undefined}
    >
      {/* A dropdown's caption goes beside its select or above it, per captionFitsBeside; every other one is underneath. */}
      {caption && w.type === "dropdown" && !beside && (
        <span className="dgx-wlab top">{caption}</span>
      )}
      {beside ? (
        <div className="dgx-selrow">
          <span className="dgx-wlab">{caption}</span>
          {body}
        </div>
      ) : (
        body
      )}
      {caption && w.type !== "dropdown" && (
        <span className="dgx-wlab">{caption}</span>
      )}
    </div>
  );
}
/** Does a dropdown's caption fit BESIDE its select? Counted in glyphs, never from the DOM — docs/widgets.md. */
const CAP_ADV = 6 * 0.62; // uppercase advance at .dgx-wlab's size
const SEL_ADV = 9 * 0.6; // monospace advance at .dgx-sel's size
const SEL_CHROME = 26; // border, padding and the native arrow
const GAP = 4; // .dgx-selrow's gap
function captionFitsBeside(
  caption: string,
  options: { label: string }[],
  boxW: number,
): boolean {
  const widest = options.reduce((m, o) => Math.max(m, o.label.length), 1);
  const need = caption.length * CAP_ADV + GAP + widest * SEL_ADV + SEL_CHROME;
  return need <= boxW - 4; // less .dgx-w's own breathing room
}

// Memoised: it holds its own param tap, so a frame that did not move THIS number must not redraw it.
const Widget = memo(WidgetInner);

// Fit one line of text to a box in world units: glyph-count width, capped by height, floored so it never vanishes.
function fitFont(label: string, w: number, h: number): number {
  const GLYPH = 0.58;
  const byWidth = (w * 0.86) / Math.max(1, label.length * GLYPH);
  return Math.max(8, Math.min(byWidth, h * 0.6));
}

/** What the header leaves the NAME, in px — the top row's own numbers, repeated, docs/nodeCard.md. */
function headerNameW(n: GraphNode, hasGlyph: boolean): number {
  const HD_PAD = 10;
  const HD_GAP = 7;
  const lead = hasGlyph ? 13 : 8;
  // The corner bubbles take NOTHING: they hang off the card at `top:-8px`, over its border rather than its text.
  return Math.max(16, n.w - HD_PAD * 2 - lead - HD_GAP);
}

/** One corner bubble, in the order they sit: the corner first, then leftwards. */
export type CornerButton = "plugin" | "bypass" | "menu" | "open";

/** Which bubbles a node's corner shows — ONE list, read by three things, docs/nodeCard.md. */
function cornerButtons(n: GraphNode, canOpenMenu: boolean): CornerButton[] {
  const out: CornerButton[] = [];
  // Neither on a baked module: no live plugin, so no window to open and nothing to bypass.
  const baked = !!n.frozen && n.kind === "module";
  if (n.hasNativePluginUI && n.module && !baked) out.push("plugin");
  if (n.kind === "module" && n.module && !baked) out.push("bypass");
  if (canOpenMenu && n.module && n.note === undefined) out.push("menu");
  // The only way into a box, and the only way back out of one — see packages/song/docs/assemblies.md.
  if (n.assemblyOf && n.module) out.push("open");
  return out;
}

// The glyph's height on the far card, taken from the NODE: it sits on its own line, so it needs a share of height.
const farIconPx = (w: number, h: number): number =>
  Math.min(h * 0.34, w * 0.34);

// The armed-track input meter: its own store subscription, so a moving input re-renders 4px, not the graph.
function InputMeterBar({
  trackId,
  order,
}: {
  trackId: string;
  order: string[];
}) {
  const level = useInputLevel(trackId, order);
  if (level === null) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 4,
        overflow: "hidden", // clips the fill to the card's rounded bottom corners
        borderBottomLeftRadius: 10,
        borderBottomRightRadius: 10,
        pointerEvents: "none",
        background: "rgba(239,68,68,0.22)", // red-500 @ 22%
      }}
    >
      {/* Scaled, not resized: a width would reflow this every frame the engine speaks (docs/meters.md). */}
      <div
        style={{
          height: "100%",
          width: "100%",
          transform: `scaleX(${level})`,
          transformOrigin: "left",
          background: CTRL["@arm"], // red-500, matching the arm control
        }}
      />
    </div>
  );
}

/** The fader's VU — the same strip as the Mix panel's, with its own subscription, docs/nodeCard.md. */
function FaderMeter({ trackId, order }: { trackId: string; order: string[] }) {
  const t = useTrackLevel(trackId, order);
  if (t === null) return null;
  return (
    <div className="dgx-fmeter">
      {/* The SHADE, not the fill: it covers the ramp down to the level, scaled rather than resized. */}
      <i style={{ transform: `scaleY(${1 - t})` }} />
    </div>
  );
}

function NodeInner({
  n,
  selected,
  showWidgets,
  far,
  ch,
  trackOrder,
  onTapNode,
  onContext,
  onOpenPlugin,
  onBypass,
  onToggleAssembly,
  onNodeMenu,
  warning,
  onDragStart,
  onTapWidget,
  onPickWidget,
  onPickAsset,
  trackInput,
  onPickTrackInput,
  onWatchWaveform,
  onContextParam,
  sinkPlay,
  onTapJack,
  patchWant,
  onLandAutomation,
  onStartAutomation,
  onStartEvent,
  onLandEvent,
  onHeaderDrag,
}: {
  n: GraphNode;
  selected: string | null;
  showWidgets: boolean;
  // The camera is too far for the node's content: draw just its name, fitted to the card.
  far: boolean;
  ch: Channels;
  // The engine level index order, so a track's meter bar can find its slot; the node itself never reads levels.
  trackOrder: string[];
  onTapNode: (n: GraphNode) => void;
  onContext: (n: GraphNode, e: React.MouseEvent) => void;
  onOpenPlugin: (module: string) => void;
  onBypass: (module: string) => void;
  /** Open or close an assembly's box. Session state: nothing about it is written to the project. */
  onToggleAssembly?: (name: string) => void;
  /** The ⋮ bubble was clicked: this host's menu for the node — the button exists only when given. */
  onNodeMenu?: (n: GraphNode, at: { x: number; y: number }) => void;
  /** What the engine reported about THIS node's plugin, if anything. */
  warning?: string;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTapWidget: (n: GraphNode, w: WebWidget) => void;
  onPickWidget: (n: GraphNode, w: WebWidget, value: number) => void;
  /** Open the library browser for this widget — a FILE for the module field the widget names. */
  onPickAsset: (n: GraphNode, param: string, x: number, y: number) => void;
  /** What this TRACK is fed from, as a chip on its header; undefined draws none. */
  trackInput?: string;
  onPickTrackInput: (n: GraphNode, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** Right-click on one of this node's controls — the menu for the PARAM, not for the module. */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  sinkPlay?: SinkPlay;
  /** A jack was pressed or released — BOTH halves, since `phase` is what tells the two gestures apart. */
  onTapJack?: (
    n: GraphNode,
    side: "in" | "out",
    jack: Jack,
    index: number,
    phase: "down" | "up",
  ) => void;
  /** The cable in hand: the side its loose end seeks, its signal, its node — what gates a landing. */
  patchWant?: {
    seeking: "in" | "out";
    type: WebSignal;
    node: string;
    kind: "signal" | "automation" | "event";
  } | null;
  /** A curve's cable landed on one of this node's widgets — bind it to that param. */
  onLandAutomation?: (n: GraphNode, w: WebWidget) => void;
  /** Its other end: a press on this curve's output starts that cable. */
  onStartAutomation?: (n: GraphNode) => void;
  /** A press on one of this module's event sockets starts an event cable. */
  onStartEvent?: (n: GraphNode, event: string) => void;
  /** …and it landed on this envelope's ear. */
  onLandEvent?: (n: GraphNode) => void;
  /** The header was pressed on a node the host lets you move — absent, the press pans instead. */
  onHeaderDrag?: (n: GraphNode, e: React.PointerEvent) => void;
}) {
  const { ModuleIcon, moduleGlyph, TrackIcon, trackLabel } = useIcons();
  // The category whose glyph this node wears. A sink has none of its own, but it IS io, so it gets io's arrows.
  const iconCategory =
    n.kind === "sink"
      ? ("io" as const)
      : n.kind === "module"
        ? n.category
        : undefined;
  /** A lane's FADER wears that lane's face — a strip is what a track's level became, so it reads as the track. */
  const trackFace = n.trackFace;
  // Does this node draw a glyph? Decides whether the accent dot steps aside and the far card reserves height.
  const hasGlyph =
    n.kind === "track" || !!trackFace || !!moduleGlyph(iconCategory, n.missing);
  // The name the card wears: the lane it is the strip of, else the MODULE this node uses — its own underneath (docs/nodeCard.md).
  // A lane's is spelt WITHOUT its instrument code, which the glyph beside it already says; the TRACK node keeps its id, being addressed by it.
  const headName = trackFace
    ? (trackLabel?.(trackFace) ?? trackFace)
    : n.uses
      ? moduleDisplayName(n.uses)
      : n.label;
  // The corner cluster, decided once, since three things read this same list.
  const corners = cornerButtons(n, !!onNodeMenu);
  const slot = (b: CornerButton) => corners.indexOf(b);
  const sel =
    (!!n.chain && n.chain === selected) ||
    (!!n.chains && !!selected && n.chains.includes(selected)) ||
    (n.kind === "module" && !!n.module && n.module === selected);
  // A node with a problem, in TWO colours: amber for a plugin refused, red for one absent — docs/nodeCard.md.
  const amber = !!n.notSupported;
  const red = n.missing || n.stub || n.unknownPlugin || amber;
  const flagCls = amber ? " unsupported" : red ? " stub" : "";
  const flagText = n.missing
    ? "module not found"
    : n.stub
      ? "missing plugin"
      : n.unknownPlugin
        ? "unknown plugin"
        : n.notSupported
          ? "not supported"
          : null;
  // Where the signal ENTERS or LEAVES: a live input, or one of the built-in outputs — docs/nodeCard.md.
  const edge = n.kind === "sink" || n.monitor !== undefined;
  const cls = [
    "dgx-node",
    `k-${amber ? "unsupported" : red ? "stub" : n.kind}`,
    edge ? "edge" : "",
    "tappable",
    sel ? "sel" : "",
    n.frozen || n.autoFrozen ? "frozen" : "", // the frost wash, on the point and on everything inside its render
    n.pending ? "pending" : "",
    far ? "far" : "", // far ⇒ name only; every other LOD draws header + content
  ]
    .filter(Boolean)
    .join(" ");

  // The armed track's input meter, at every LOD, so an armed track reads as "recording this" at any zoom.
  const armBar =
    n.kind === "track" ? (
      <InputMeterBar trackId={n.label} order={trackOrder} />
    ) : null;

  // The module on its way: a spinner, and the sockets its host wired it by — none are interactive.
  if (n.pending)
    return (
      <div
        className={cls}
        data-node-id={n.id}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          display: "grid",
        }}
        aria-busy="true"
        aria-label="creating a module"
      >
        <i className="dgx-spin" />
        {(["in", "out"] as const).map((side) =>
          (n.jacks?.[side] ?? []).map((p, i, all) => (
            <span
              key={`${side}:${i}`}
              className={`dgx-port ${side}`}
              style={{
                ["--jc" as string]: cableColorFor(p.type),
                // The same spread as a real card's sockets, so the cables `jackPoint` aims meet them.
                left: `${((i + 1) / (all.length + 1)) * 100}%`,
              }}
            />
          )),
        )}
      </div>
    );

  // An OPEN assembly: a frame around its members, drawn BEFORE them so they sit on top of it. It
  // has no sockets — the members are showing the real ones. See packages/song/docs/assemblies.md.
  if (n.assemblyOf?.open)
    return (
      <div
        className={`dgx-frame${onHeaderDrag ? " grab" : ""}`}
        data-node-id={n.id}
        style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
        onContextMenu={(e) => onContext(n, e)}
      >
        <div
          className="dgx-frame-hd"
          onPointerDown={(e) => onHeaderDrag?.(n, e)}
          title={n.assemblyOf.uses}
        >
          <span className="dgx-frame-nm">{n.label}</span>
          <span
            className="dgx-cbtn dgx-obtn on"
            title={`Close ${n.label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (n.module) onToggleAssembly?.(n.module);
            }}
          >
            <i />
          </span>
        </div>
      </div>
    );

  // A NOTE: a doc module, its text and nothing else, before the LOD branch — docs/nodeCard.md.
  if (n.note !== undefined)
    return (
      <div
        className={`${cls} dgx-note`}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          opacity: n.dim ? 0.5 : 1,
        }}
        onClick={() => onTapNode(n)}
        onContextMenu={(e) => onContext(n, e)}
        title={n.label}
      >
        {/* `pre-wrap`: the author's own line breaks are the shape of the note; `noteSize` reserved the width. */}
        <div className="dgx-note-body">{n.note}</div>
      </div>
    );

  // Far LOD: widgets are unreadable at this zoom, so the whole card becomes the name, sized to fill it.
  if (far) {
    // The module here too, for the header's reason: two LODs answering differently would be two cards.
    const label = headName || (n.kind === "sink" ? "OUT" : n.kind);
    return (
      <div
        className={`${cls}${onHeaderDrag ? " grab" : ""}`}
        data-node-id={n.id}
        // No header at this zoom, so the whole card is the pin gesture's handle — docs/hosting.md.
        onPointerDown={onHeaderDrag ? (e) => onHeaderDrag(n, e) : undefined}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          opacity: n.dim ? 0.5 : 1,
          ...(n.kind === "track" && n.color
            ? {
                borderTop: `5px solid ${n.color}`,
                borderTopLeftRadius: 0,
                borderTopRightRadius: 0,
              }
            : {}),
          ...(n.color
            ? { background: `color-mix(in srgb, ${n.color} 12%, var(--card))` }
            : {}),
        }}
        onClick={() => onTapNode(n)}
        onContextMenu={(e) => onContext(n, e)}
      >
        {/* Stacked, unlike the header: at this zoom the name IS the card, so the glyph spends HEIGHT rather than width. */}
        {n.kind === "track" ? (
          <TrackIcon
            name={label}
            video={n.video}
            className="dgx-ticon"
            style={{ fontSize: farIconPx(n.w, n.h) }}
          />
        ) : (
          <ModuleIcon
            category={iconCategory}
            missing={n.missing}
            className="dgx-ticon"
            style={{ fontSize: farIconPx(n.w, n.h) }}
          />
        )}
        <span
          className={`dgx-far${flagCls}`}
          style={{
            fontSize: fitFont(
              label,
              n.w,
              n.h - (hasGlyph ? farIconPx(n.w, n.h) : 0),
            ),
          }}
        >
          {label}
        </span>
        {armBar}
      </div>
    );
  }

  return (
    <div
      className={cls}
      data-node-id={n.id}
      style={{
        left: n.x,
        top: n.y,
        width: n.w,
        height: n.h,
        opacity: n.dim ? 0.5 : 1,
        ...(n.kind === "track" && n.color
          ? {
              borderTop: `5px solid ${n.color}`,
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
            }
          : {}),
        ...(n.color
          ? { background: `color-mix(in srgb, ${n.color} 12%, var(--card))` }
          : {}),
      }}
      onClick={() => onTapNode(n)}
      onContextMenu={(e) => onContext(n, e)}
    >
      <div
        className={`dgx-hd${onHeaderDrag ? " grab" : ""}`}
        // Drag the header, move the card — the pin gesture, docs/hosting.md.
        onPointerDown={onHeaderDrag ? (e) => onHeaderDrag(n, e) : undefined}
      >
        {/* The TOP row: the glyph, the module's name, and whatever stands beside them. */}
        <span className="dgx-hdtop">
          {/* The accent dot marks identity only on a node with no glyph of its own, which leads the row instead. */}
          {!hasGlyph && <span className="dgx-tri" />}
          {trackFace ? (
            <TrackIcon name={trackFace} className="dgx-ticon" />
          ) : n.kind === "track" ? (
            <TrackIcon name={n.label} video={n.video} className="dgx-ticon" />
          ) : (
            <ModuleIcon
              category={iconCategory}
              missing={n.missing}
              className="dgx-ticon"
            />
          )}
          {/* The name is SIZED to fit rather than ellipsed, by headerFontPx over headerNameW; see docs/nodeCard.md. */}
          <span
            className={`dgx-nm${flagCls}`}
            // The whole ref, not just the word drawn: the filing is one hover away rather than gone.
            title={n.uses ? `${n.uses}\n${n.label}` : n.label}
            style={{
              fontSize: headerFontPx(headName, headerNameW(n, hasGlyph)),
            }}
          >
            {headName}
          </span>
          {/* The header keeps only a real sub — the chains a module is shared across; the flag is drawn in the content area. */}
          {n.sub && <span className={`dgx-sub${flagCls}`}>{n.sub}</span>}
          {/* What feeds this track, in the header row rather than on a corner because it carries a NAME. */}
          {trackInput !== undefined && (
            <button
              type="button"
              className={`dgx-tin${trackInput === "aucune" ? " unknown" : ""}`}
              title={`Interface input: ${trackInput} — click to change`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPickTrackInput(n, e.clientX, e.clientY);
              }}
            >
              {trackInput}
            </button>
          )}
        </span>
        {/* The node's own name, UNDER the row and clear of the bubbles — only when there are two names to tell apart. */}
        {n.uses && <span className="dgx-nodenm">{n.label}</span>}
      </div>

      {/* The native plugin's editor: a corner bubble, not a header item, where it stole width from the longest names. */}
      {corners.includes("plugin") && (
        <span
          className="dgx-cbtn dgx-pbtn"
          style={{ "--slot": slot("plugin") } as React.CSSProperties}
          title="Open native plugin UI"
          // Keep the press off the pane, as a widget's does — otherwise it arms a pan and the click never reaches the button.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenPlugin(n.module!);
          }}
        >
          <i />
        </span>
      )}

      {/* Bypass — a module's, never a lane's, where it would read as the mute the mixer strip already carries. */}
      {corners.includes("bypass") && (
        <span
          className={`dgx-cbtn dgx-bbtn${n.bypassed ? " on" : ""}`}
          style={{ "--slot": slot("bypass") } as React.CSSProperties}
          title={n.bypassed ? "Bypassed — click to re-enable" : "Bypass"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onBypass(n.module!);
          }}
        >
          <i />
        </span>
      )}

      {/* A box's only gesture: open it to see what is inside, close it to get the appliance back. */}
      {corners.includes("open") && (
        <span
          className={`dgx-cbtn dgx-obtn${n.assemblyOf?.open ? " on" : ""}`}
          style={{ "--slot": slot("open") } as React.CSSProperties}
          title={
            n.assemblyOf?.open
              ? `Close ${n.label}`
              : `Open ${n.label} — ${n.assemblyOf?.uses ?? ""}`
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (n.module) onToggleAssembly?.(n.module);
          }}
        >
          <i />
        </span>
      )}

      {/* The node's own menu — alternatives and freezing — reported to the HOST rather than drawn here. */}
      {corners.includes("menu") && (
        <span
          className={`dgx-cbtn dgx-abtn${n.alternative && n.alternative !== "1" ? " on" : ""}`}
          style={{ "--slot": slot("menu") } as React.CSSProperties}
          title={
            n.alternative && n.alternative !== "1"
              ? `Alternative "${n.alternative}" — click for the node's menu`
              : "Alternatives, freeze…"
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onNodeMenu?.(n, { x: e.clientX, y: e.clientY });
          }}
        >
          <i />
        </span>
      )}

      {/* What the engine said went wrong with THIS plugin, on hover: often the only word on a module doing nothing. */}
      {warning && (
        <span
          className="dgx-wbtn"
          title={warning}
          role="img"
          aria-label={`engine warning: ${warning}`}
        >
          !
        </span>
      )}

      {/* AUTOMATICALLY frozen: the same snowflake, saying it gives way to a touch — packages/song/docs/autoFreeze.md. */}
      {!n.frozen && n.autoFrozen && (
        <span
          className="dgx-fbtn auto"
          role="img"
          aria-label="frozen automatically"
          title={
            n.autoFrozen === n.module
              ? "Frozen automatically — this VST and everything upstream play as a render, so an engine without the VST can play it. Touch a control to edit it live."
              : `Inside ${n.autoFrozen}'s automatic render. Touch a control to edit it live.`
          }
        >
          <Snowflake />
        </span>
      )}

      {/* FROZEN: its own badge rather than a shade of `dim`, which means the opposite — see packages/song/docs/freeze.md. */}
      {n.frozen && (
        <span
          className="dgx-fbtn"
          role="img"
          aria-label="frozen"
          title={
            n.frozen === "at"
              ? "Frozen here — everything upstream is playing as one render. Unfreeze from the ⋮ menu."
              : "Inside a render — this node is baked and is not running. Unfreeze the point downstream of it."
          }
        >
          <Snowflake />
        </span>
      )}

      {/* Ports. `jacksFor` in graph.ts decides which show; here they are only spaced evenly down the edge. */}
      {/* A curve gets one mauve socket and no input, kept out of `jacksFor` because it carries no signal. */}
      {n.kind === "curve" && (
        <span
          className={`dgx-port out${onStartAutomation ? " plug" : ""}`}
          title={
            onStartAutomation
              ? "drag onto a knob to bind this curve to it"
              : undefined
          }
          style={{ ["--jc" as string]: MAUVE, top: "50%" }}
          // The press starts the cable, and is stopped so it does not also arm a pan.
          onPointerDown={
            onStartAutomation
              ? (e) => {
                  e.stopPropagation();
                  onStartAutomation(n);
                }
              : undefined
          }
        >
          <i />
        </span>
      )}
      {/* An envelope LISTENS: one socket on its left edge, where the note-on cable lands. */}
      {n.eventIn && (
        <span
          className={`dgx-port ev evin${
            patchWant?.kind === "event" && n.curveOf?.module ? " plug" : ""
          }`}
          title={
            n.curveOf?.module
              ? "event in — a note-on restarts this envelope"
              : "event in — bind this curve to a param first, then a note-on can fire it"
          }
          style={{ ["--jc" as string]: cableColorFor("event"), top: "50%" }}
          // Only a BOUND envelope can take one: the trigger is written onto the binding.
          onPointerUp={
            patchWant?.kind === "event" && n.curveOf?.module
              ? (e) => {
                  e.stopPropagation();
                  onLandEvent?.(n);
                }
              : undefined
          }
        >
          <i />
        </span>
      )}
      {/* …and a module ANNOUNCES, down its right edge, each socket saying which event it is. */}
      {(n.events ?? []).map((name, i, all) => (
        <span
          key={`ev:${name}`}
          className={`dgx-port ev evout${onStartEvent ? " plug" : ""}`}
          title={`${name} — drag onto an envelope's ear to make it fire that envelope`}
          onPointerDown={
            onStartEvent
              ? (e) => {
                  e.stopPropagation();
                  onStartEvent(n, name);
                }
              : undefined
          }
          style={{
            ["--jc" as string]: cableColorFor("event"),
            // The same fractions eventPoint uses, so the cable meets the hole.
            top: `${((i + 1) / (all.length + 1)) * 100}%`,
          }}
        >
          <i />
          <span className="dgx-evlab evout" style={{ top: "50%" }}>
            {name}
          </span>
        </span>
      ))}
      {n.kind !== "curve" &&
        (["in", "out"] as const).map((side) =>
          (n.jacks?.[side] ?? []).map((p, i, all) => {
            // Which jacks the patch gesture arms, at rest and with a cable in hand — docs/hosting.md.
            const plug =
              !!onTapJack &&
              (patchWant
                ? p.free &&
                  side === patchWant.seeking &&
                  p.type === patchWant.type &&
                  // …and never back onto the node the cable LEFT, which the verb refuses outright.
                  n.id !== patchWant.node
                : side === "out" || !p.free);
            return (
              <span
                key={`${side}:${p.name ?? i}`}
                className={`dgx-port ${side}${p.free ? " free" : ""}${plug ? " plug" : ""}`}
                title={
                  p.name
                    ? `${p.name} (${p.type})${p.free ? " — free" : ""}`
                    : undefined
                }
                style={{
                  // Coloured by what the port carries, so a socket matches the cable for it.
                  ["--jc" as string]: cableColorFor(p.type),
                  // Spread across the WIDTH, and it MUST agree with `jackPoint` — docs/hosting.md.
                  left: `${((i + 1) / (all.length + 1)) * 100}%`,
                }}
                // The press, not the click, since a cable is drawn by DRAGGING out of a socket.
                onPointerDown={
                  plug
                    ? (e) => {
                        e.stopPropagation();
                        onTapJack?.(n, side, p, i, "down");
                      }
                    : undefined
                }
                // …and the release lands it — on the socket the press armed, that is a CLICK instead.
                onPointerUp={
                  plug
                    ? (e) => {
                        e.stopPropagation();
                        onTapJack?.(n, side, p, i, "up");
                      }
                    : undefined
                }
              >
                <i />
              </span>
            );
          }),
        )}

      {/* A sink with a declared FACE falls through to the widget branch below, so its controls are
          children of the CARD and land on `widgetRect`'s coordinates. Rendering them inside
          `.dgx-out` — which is itself absolute at top:38px — added the header's height twice and
          pushed them out the bottom. `mainOutCard` has always sized the OUT card to its `ui`, so
          the room was allocated and the face never drawn. */}
      {n.kind === "sink" && !(n.ui && showWidgets) ? (
        <div className="dgx-out">
          <b>OUT</b>
          <span>stereo</span>
          {/* Auditioning happens at the OUTPUT, where the signal after the whole chain arrives. */}
          {sinkPlay ? (
            <button
              type="button"
              className="dgx-play"
              disabled={!!sinkPlay.disabled}
              // The node is selectable and draggable; a click on the button is neither.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                sinkPlay.onToggle();
              }}
              // Says WHY it is dead rather than looking broken — no engine, or nothing to play.
              title={sinkPlay.title ?? (sinkPlay.playing ? "Stop" : "Listen")}
              aria-label={sinkPlay.playing ? "Stop" : "Listen"}
            >
              {sinkPlay.playing ? (
                <Square className="size-3 fill-current" />
              ) : (
                <Play className="size-3 fill-current" />
              )}
            </button>
          ) : null}
        </div>
      ) : n.kind === "curve" ? (
        <div className="dgx-curve">
          <Spark sub={n.sub ?? ""} />
          <div className="dgx-cmeta">
            <b>{n.sub ?? "curve"}</b>
          </div>
        </div>
      ) : n.ui && showWidgets ? (
        Object.entries(n.ui.widgets).map(([k, w]) => (
          <Widget
            key={k}
            n={n}
            w={w}
            ch={ch}
            onDragStart={onDragStart}
            onTap={onTapWidget}
            onPick={onPickWidget}
            onPickAsset={onPickAsset}
            onWatchWaveform={onWatchWaveform}
            onContextParam={onContextParam}
            // A curve's cable is in hand and this widget could take it — see onLandAutomation.
            onLandAutomation={
              patchWant?.kind === "automation" ? onLandAutomation : undefined
            }
          />
        ))
      ) : (
        // No grid and no content: keep the card's shape and say what is missing. A flagged module says WHY, in red.
        <div className={`dgx-empty${flagCls}`}>{flagText ?? "No Options"}</div>
      )}
      {/* What this lane HOLDS, under its controls, once the widgets are legible; see docs/nodeCard.md. */}
      {n.kind === "track" && n.clips?.length && showWidgets ? (
        <ClipList clips={n.clips} more={n.clipsMore} color={n.color} />
      ) : null}
      {armBar}
    </div>
  );
}
/** A lane's events: a mini timeline of the whole lane, then the first few by name — docs/nodeCard.md. */
function ClipList({
  clips,
  more,
  color,
}: {
  clips: NonNullable<GraphNode["clips"]>;
  more?: number;
  /** The TRACK's own colour — what its clips are drawn in. Absent when the lane authors none. */
  color?: string;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const shown = clips.slice(0, CLIP_LIST_MAX);
  return (
    <div className="dgx-clips">
      {/* The lane at a glance: one block per clip, coloured by the TRACK; see docs/nodeCard.md. */}
      <div className="dgx-clip-tl">
        {clips.map((c, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the identity here — it
            // pairs a block with its row below, and two clips may share a ref and a position.
            key={i}
            className={`dgx-clip-mk${c.kind === "missing" ? " missing" : ""}${
              hot === i ? " hot" : ""
            }`}
            style={{
              left: `${c.at * 100}%`,
              width: `${c.w * 100}%`,
              ...(c.kind !== "missing" && color ? { background: color } : {}),
            }}
            title={`${c.tc} — ${c.ref}`}
            onPointerEnter={() => setHot(i)}
            onPointerLeave={() => setHot(null)}
          />
        ))}
      </div>
      {shown.map((c, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: pairs with the marker above, as there.
          key={i}
          className={`dgx-clip${c.kind === "missing" ? " missing" : ""}${
            hot === i ? " hot" : ""
          }`}
          title={
            c.kind === "missing"
              ? `${c.tc} — ${c.ref}: no such clip in this project`
              : `${c.tc} — ${c.ref} (${c.kind})`
          }
        >
          {/* WHERE first, then WHAT: a fixed-width column of positions stays a column, with tabular figures. */}
          <span className="dgx-clip-tc">{c.tc}</span>
          <span className="dgx-clip-nm">{c.ref}</span>
        </div>
      ))}
      {more ? <div className="dgx-clip more">+{more}</div> : null}
    </div>
  );
}

// Memoised: with `ch` and every handler stable, a pan or a param frame re-renders no card at all.
const Node = memo(NodeInner);

// The SVG layer OVER the cable canvas: the labels and the hit paths, everything that does not move.
function CablesInner({
  signal,
  auto,
  showLabels,
  hovered,
  setHovered,
  onInsert,
}: {
  signal: EdgeGeom[];
  auto: AutoTarget[];
  showLabels: boolean;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  // The pointer position travels with it: the `+` opens a picker, which must land where you clicked.
  onInsert?: (
    info: EdgeInsert,
    x: number,
    y: number,
    // WORLD coords of the cable's midpoint — where the picked module will be BORN.
    at: { x: number; y: number },
  ) => void;
}) {
  return (
    <>
      {/* A signal cable's NAME, kept in SVG while the cable is on the canvas; see docs/liveCables.md. */}
      {signal.map((g) => {
        const pts = g.base;
        if (!showLabels || !g.label || pts.length < 2) return null;
        const mid = pts[Math.floor(pts.length / 2)];
        return (
          <text
            key={g.id}
            className="dgx-clab"
            x={mid.x}
            y={mid.y - 6}
            textAnchor="middle"
            // A label at full strength over a half-strength cable reads as a different cable.
            opacity={g.faded ? FOREIGN_ALPHA : undefined}
          >
            {g.label}
          </text>
        );
      })}

      {/* Only the param LABEL stays here, at the chord midpoint so the hang sags clear below it. */}
      {showLabels &&
        auto.map((s) => {
          const lab = s.onWidget
            ? {
                x: (s.from.x + s.to.x) / 2,
                y: (s.from.y + s.to.y) / 2 - 6,
                anchor: "middle" as const,
              }
            : { x: s.to.x - 4, y: s.to.y - 12, anchor: "end" as const };
          return (
            <text
              key={s.id}
              className="dgx-alab"
              x={lab.x}
              y={lab.y}
              textAnchor={lab.anchor}
            >
              {s.param}
            </text>
          );
        })}

      {/* insert affordance — a transparent hit path per eligible arrow, recoloured with a `+` on hover. */}
      {signal.map((g) => {
        // No host to answer it, no `+`: an affordance that does nothing reads as a click that was missed.
        if (!g.insert || !onInsert) return null;
        const d = smoothPath(g.base);
        const on = hovered === g.id;
        const mid = midByArc(g);
        return (
          <g key={`ins:${g.id}`}>
            <path
              className="dgx-hit"
              d={d}
              onMouseEnter={() => setHovered(g.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                onInsert?.(g.insert!, e.clientX, e.clientY, mid);
              }}
            />
            {on && (
              <>
                <path className="dgx-ins-line" d={d} />
                <g
                  className="dgx-ins-btn"
                  onMouseEnter={() => setHovered(g.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInsert?.(g.insert!, e.clientX, e.clientY, mid);
                  }}
                >
                  <circle cx={mid.x} cy={mid.y} r={9} />
                  <path
                    d={`M ${mid.x - 4} ${mid.y} H ${mid.x + 4} M ${mid.x} ${mid.y - 4} V ${mid.y + 4}`}
                  />
                </g>
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
// Memoised: a pan changes the camera, not the cables, and the wobble already bypasses React.
const Cables = memo(CablesInner);

// Map a right-clicked node to the shell's menu context (track id, module node, chain name; curves have none).
function nodeToCtx(n: GraphNode): GraphMenuCtx | null {
  switch (n.kind) {
    case "track":
      return { kind: "track", id: n.label };
    case "module":
      return n.module
        ? {
            kind: "module",
            id: n.module,
            missing: n.missing,
            // Its model can be fetched: the menu grows "Download model".
            ...(n.modelDownload ? { model: true } : {}),
          }
        : null;
    case "chain":
      return { kind: "chain", id: n.chain ?? n.label };
    case "sink":
      return { kind: "sink", id: n.label };
    case "assembly":
      return n.module && n.assemblyOf
        ? { kind: "assembly", id: n.module, uses: n.assemblyOf.uses }
        : null;
    case "curve":
      return null;
  }
}

/** The camera, for a host that BORROWS it and has to put it back — docs/camera.md. */
export interface ChainsCamApi {
  fitTo: FitToFn;
  get: () => Cam;
  set: (c: Cam) => void;
}

export interface FitToOpts {
  /** Keep the zoom this fit computed and only CENTRE on this node — used to walk a chain. */
  panOnly?: GraphNode;
  /** `"height"` fills the height and lets the set run off the right, where it pans — docs/camera.md. */
  axis?: "both" | "height";
  /** Multiply the fitted zoom; below 1 it pulls BACK from a perfect fit — docs/camera.md. */
  zoom?: number;
}

export type FitToFn = (nodes: GraphNode[], opts?: FitToOpts) => boolean;

export function DomChains({
  icons,
  graph,
  selected,
  trackOrder,
  videoSpans,
  noteLanes,
  onSelect,
  onPickModule,
  onContextMenu,
  onEdgeInsert,
  onCanvasInsert,
  onConnect,
  onDisconnect,
  onAutomate,
  onReplug,
  onMoveNode,
  onCamReady,
  row,
  camStore,
  engineWarnings,
  fitKey,
  fitAxis = "both",
  command,
  onBypassModule,
  onThawAutoFreeze,
  onModuleField,
  onToggleAssembly,
  onNodeMenu,
  onTriggerRack,
  onRecorder,
  onProjectField,
  rackLit,
  onSetModuleAsset,
  onAssetBrowse,
  onLibraryBrowse,
  trackInputs,
  onPickTrackInput,
  onWatchWaveform,
  sinkPlay,
  pluginParamsStore,
  setPluginParam,
  moduleParams,
  onModuleParam,
  trackControls,
  onTrackToggle,
  onTrackSet,
  rehearsal,
  motion = true,
}: {
  /** The glyphs the nodes wear. Required, so no caller can render a graph without them. */
  icons: ChainsIcons;
  graph: LaidOutGraph;
  /** Animate a change of layout, on by default — docs/nodeMotion.md says when to turn it off. */
  motion?: boolean;
  selected: string | null;
  /** The engine level index order; the levels themselves never flow through here — docs/liveCables.md. */
  trackOrder?: string[];
  /** When each VIDEO lane is showing a picture, in seconds — omitted, its cables stay still, docs/liveCables.md. */
  videoSpans?: Readonly<Record<string, readonly LaneSpan[]>>;
  /** …and the NOTES' half of it: nothing meters MIDI, so a note cable's ripple is the velocities
   *  sounding at the playhead, against the busiest that lane ever gets (@studio/ui-chains's
   *  noteLoad.ts). By lane id, as `videoSpans` is; a lane with no notes is left out. */
  noteLanes?: Readonly<Record<string, LaneNotes>>;
  onSelect: (c: string | null) => void;
  onPickModule?: (module: string | null) => void;
  onContextMenu?: (ctx: GraphMenuCtx, x: number, y: number) => void;
  // `at` is the arrow's midpoint in WORLD px — where the picked module will be born.
  onEdgeInsert?: (
    info: EdgeInsert,
    x: number,
    y: number,
    at?: { x: number; y: number },
  ) => void;
  /** Right-click on EMPTY canvas — a pick lands wired to nothing, BORN at `at` (world px). */
  onCanvasInsert?: (
    x: number,
    y: number,
    at?: { x: number; y: number },
  ) => void;
  /** The patch cable landed: `from`/`to` are chains.yaml addresses, ready for the verb — docs/hosting.md. */
  onConnect?: (from: string, to: string) => void;
  /** A lifted cable was dropped on the bare canvas: delete its arrow — docs/hosting.md. */
  onDisconnect?: (from: string, to: string) => void;
  /** A curve cable landed — bind `curve` to `module`'s `param`, optionally fired by `trigger`. */
  onAutomate?: (
    module: string,
    param: string,
    curve: string,
    trigger?: string,
  ) => void;
  /** A lifted cable's loose end landed elsewhere: from→to becomes newFrom→newTo, one undo step. */
  onReplug?: (from: string, to: string, newFrom: string, newTo: string) => void;
  /** A module was dragged by its header and dropped: pin it there — the pin gesture, docs/hosting.md. */
  onMoveNode?: (module: string, x: number, y: number) => void;
  /** Hands the camera up, once mounted — see ChainsCamApi. */
  onCamReady?: (cam: ChainsCamApi) => void;
  /** This graph is arranged as a ROW to be read across — it changes what the navigation MEANS, docs/hosting.md. */
  row?: boolean;
  // Where the camera lives BETWEEN mounts: the graph unmounts with its pane. See docs/chainsGraph.md.
  camStore?: CamStore;
  /** Engine load problems by PluginDoc id — a node badges itself from this. */
  engineWarnings?: Record<string, string>;
  // Identifies WHICH graph is on screen: a change re-frames, a redraw of the same one leaves the camera alone.
  fitKey?: string | number | null;
  /** How the first frame is chosen: "both" fits the whole graph, "height" lets the width overflow. */
  fitAxis?: "both" | "height";
  command: (line: string) => void | Promise<void>;
  // Bypass a module. Separate from `command` because it must RELOAD — the quiet path never bumps reloadKey.
  onBypassModule?: (module: string) => void;
  /** Thaw an AUTOMATIC freeze before a control on it is used: its VST is baked, and an edit must reach a live one (packages/song/docs/autoFreeze.md). */
  onThawAutoFreeze?: (module: string) => void;
  /** Set a module's own FIELD, `node param <node> @<field> <v>`. Separate for onBypassModule's
   *  reason and one more: an intrinsic has no optimistic value, so the reload IS the feedback. */
  onModuleField?: (line: string) => void | Promise<void>;
  /** Open or close an ASSEMBLY's box. Session state the HOST holds: nothing is written to the project. */
  onToggleAssembly?: (name: string) => void;
  /** The ⋮ bubble: open THIS host's menu for that node — the menu is the host's, docs/hosting.md. */
  onNodeMenu?: (n: GraphNode, at: { x: number; y: number }) => void;
  /** A RACK pad was clicked: the graph says WHICH sound was asked for and stops there — docs/hosting.md. */
  onTriggerRack?: (module: string, symbol: string) => void;
  /** A RECORDER's button was pressed. `pluginId` is what the ENGINE keys a node by; `module` is
   *  what a VERB names. The host needs both — record and clear go down the socket, save is a
   *  command. See engine/st0-engine/docs/recorder.md. */
  /** Set a PROJECT setting — `project <field> <value>`. Absent means the dropdown reads only. */
  onProjectField?: (field: string, value: string) => void;
  onRecorder?: (
    verb: RecVerb,
    node: { module: string; pluginId?: string },
  ) => void;
  /** Which rack sounds are firing right now, as a store each pad subscribes to. See `RackLitStore`. */
  rackLit?: RackLitStore;
  // Set a file-valued param on a module: `param` is the key ("nam"), `file` assets-relative or "none".
  onSetModuleAsset?: (module: string, kind: string, file: string) => void;
  /** Open the asset browser for a module's file-valued param, at viewport coords. */
  onAssetBrowse?: (module: string, kind: string, x: number, y: number) => void;
  onLibraryBrowse?: (
    module: string,
    kind: string,
    x: number,
    y: number,
  ) => void;
  /** What each track is fed FROM — what the HOST knows about a live input and the graph does not. */
  trackInputs?: Record<string, string>;
  /** Choose what feeds a track, at the click's viewport coords — the popup is the host's. */
  onPickTrackInput?: (trackId: string, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap while a waveform widget is on screen. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** A play button on the sink. Omit it and there is none — see SinkPlay. */
  sinkPlay?: SinkPlay;
  /** This graph is a REHEARSAL: a picked module FIELD is shown and never written — docs/hosting.md. */
  rehearsal?: boolean;
  pluginParamsStore?: PluginParamsStore;
  setPluginParam?: (id: string, name: string, value: number) => void;
  /** What a module with NO plugin is set to, lent by the surface that realises it — docs/hosting.md. */
  moduleParams?: Record<string, Record<string, number>>;
  /** …and the way back, for the same modules. Called per frame during a drag. */
  onModuleParam?: (module: string, name: string, value: number) => void;
  trackControls?: Record<string, TrackControlValues>;
  onTrackToggle?: (trackId: string, control: "mute" | "solo" | "arm") => void;
  onTrackSet?: (
    trackId: string,
    control: "volume" | "pan",
    value: number,
  ) => void;
}) {
  useCss();
  // NOT subscribed here: each widget taps its own plugin — engine-browser's docs/params.md.
  const params = pluginParamsStore ?? EMPTY_PARAMS_STORE;
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  // The camera lives OUTSIDE React: `cam` is what is on screen, `goal` where a gesture takes it — docs/camera.md.
  const cam = useRef<Cam>({ ...(camStore?.current ?? { x: 0, y: 0, k: 1 }) });
  const goal = useRef<Cam>({ ...cam.current });
  // The point a zoom holds still: where the wheel was, in host coordinates.
  const anchor = useRef({ px: 0, py: 0 });
  const kick = useRef<() => void>(() => {});
  // Through a ref: the wheel and the pan are bound once, and would read `row` as it first was.
  const rowRef = useRef(row);
  rowRef.current = row;
  // Redraws the cable canvas, which sits OUTSIDE `.dgx-world` and so is moved by no transform.
  const paintRef = useRef<() => void>(() => {});
  // Has the graph been framed? A saved camera means the user already has a view, so it starts true.
  const fitted = useRef(camStore?.current != null);
  // Has the USER taken the camera? Separate from `fitted` — see docs/chainsGraph.md.
  const userMoved = useRef(camStore?.current != null);
  const camStoreRef = useRef(camStore);
  camStoreRef.current = camStore;
  // What the drawing takes from the camera, committed only when one of the three differs.
  const [lod, setLod] = useState<Lod>(() => lodFor(cam.current.k));
  const lodRef = useRef(lod);
  // Persist ONLY after a real fit: the identity camera is indistinguishable from one the user chose.
  const persist = () => {
    const store = camStoreRef.current;
    if (store && fitted.current) store.current = { ...cam.current };
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  // Put the camera somewhere outright — a fit, not a gesture, so it lands whole in one frame.
  const place = (c: Cam) => {
    Object.assign(cam.current, c);
    Object.assign(goal.current, c);
    applyCam(worldRef.current, cam.current);
    paintRef.current();
    const next = lodFor(cam.current.k);
    if (!sameLod(next, lodRef.current)) {
      lodRef.current = next;
      setLod(next);
    }
    persist();
  };
  // A camera restored from the store is never placed by a fit, so it needs this one write.
  useLayoutEffect(() => {
    applyCam(worldRef.current, cam.current);
    paintRef.current();
  }, []);
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  // Optimistic values the hand set, outranking the incoming frame until it catches up.
  const [override, setOverride] = useState<Record<string, number>>({});

  // Latest callbacks in refs, so the once-bound window listeners read current values without re-subscribing.
  const cb = useRef({
    onSelect,
    onPickModule,
    onContextMenu,
    onEdgeInsert,
    onCanvasInsert,
    onConnect,
    onDisconnect,
    onAutomate,
    onReplug,
    onMoveNode,
    command,
    onBypassModule,
    onThawAutoFreeze,
    onModuleField,
    onNodeMenu,
    onTriggerRack,
    onRecorder,
    onProjectField,
    onSetModuleAsset,
    onAssetBrowse,
    onLibraryBrowse,
    onPickTrackInput,
    setPluginParam,
    onModuleParam,
    onTrackToggle,
    onTrackSet,
  });
  cb.current = {
    onSelect,
    onPickModule,
    onContextMenu,
    onEdgeInsert,
    onCanvasInsert,
    onConnect,
    onDisconnect,
    onAutomate,
    onReplug,
    onMoveNode,
    command,
    onBypassModule,
    onThawAutoFreeze,
    onModuleField,
    onNodeMenu,
    onTriggerRack,
    onRecorder,
    onProjectField,
    onSetModuleAsset,
    onAssetBrowse,
    onLibraryBrowse,
    onPickTrackInput,
    setPluginParam,
    onModuleParam,
    onTrackToggle,
    onTrackSet,
  };

  // --- the compiled geometry: signal cables (with insert eligibility) + automations ---
  const model = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    // With a box OPEN, the cables that are not its own are the traffic crossing it: they still run
    // right over the frame, at half, so the wiring inside reads first. Nothing fades otherwise.
    const anyOpen = graph.nodes.some((n) => n.assemblyOf?.open);
    // …and a CLOSED box has swallowed its lanes' cards, so a metered one's signal now leaves from
    // the box. Without this a folded set reaches nothing and not one cable ripples.
    const foldedAt = new Map<string, string>();
    for (const n of graph.nodes)
      if (n.assemblyOf && !n.assemblyOf.open)
        for (const m of n.assemblyOf.members) foldedAt.set(m, n.id);
    const signal: EdgeGeom[] = [];
    const auto: AutoTarget[] = [];
    // An automation cable is a CABLE: only its param LABEL stays in the SVG, off the AutoTarget list.
    const autoGeom: ({ id: string } & CableGeom)[] = [];
    for (const e of graph.edges) {
      if (e.automation) {
        const a = autoTarget(e, byId);
        if (!a) continue;
        auto.push(a);
        autoGeom.push({
          id: a.id,
          ...buildCableGeom(
            hangPoints(a.from, a.to),
            WOBBLE_STEP,
            WOBBLE_MAX_SAMPLES,
          ),
        });
        continue;
      }
      if (e.points.length < 2) continue;
      signal.push({
        id: e.id,
        // Plugged into the SOCKETS rather than aimed at the borders dagre routed to — see cablePath.
        ...buildCableGeom(
          cablePath(e, byId.get(e.source), byId.get(e.target)),
          WOBBLE_STEP,
          WOBBLE_MAX_SAMPLES,
        ),
        source: e.source,
        target: e.target,
        label: e.label,
        signal: e.signal,
        faded: anyOpen && !e.assembly,
        insert: insertFor(e.source, e.target, byId),
      });
    }
    return { byId, signal, auto, autoGeom, foldedAt };
  }, [graph]);

  // --- node motion: the cards slide, arrive and leave rather than jumping (docs/nodeMotion.md) ---
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  ).current;
  const animate = motion && !reducedMotion;
  const motions = useRef<Map<string, Motion>>(new Map());
  // Where each node is DRAWN right now, ghosts included — what the next layout measures from.
  const drawn = useRef<Map<string, Ghost<GraphNode>>>(new Map());
  const [ghosts, setGhosts] = useState<Ghost<GraphNode>[]>(EMPTY_GHOSTS);
  const ghostCount = useRef(0);
  ghostCount.current = ghosts.length;
  // React has just replaced the nodes, so the element map is stale: re-read it once, next frame.
  const rebind = useRef(true);
  const nodeEls = useRef<Map<string, HTMLElement>>(new Map());
  // Which ids currently carry an inline transform, so each is cleared exactly once.
  const styled = useRef<Set<string>>(new Set());
  const cablesSvg = useRef<SVGSVGElement>(null);
  const layoutNodes = useRef(graph.nodes);
  layoutNodes.current = graph.nodes;

  // The positions a settled graph is measured from: the layout, and nothing else.
  const settledDrawn = (): Map<string, Ghost<GraphNode>> =>
    new Map(
      layoutNodes.current.map((n) => [n.id, { node: n, x: n.x, y: n.y }]),
    );

  /** One frame of movement: advance, write, and rebuild the cables from where the cards ARE. */
  const motionStep = useRef<(dt: number) => boolean>(() => false);
  motionStep.current = (dt: number) => {
    const ms = motions.current;
    if (rebind.current) {
      rebind.current = false;
      const world = worldRef.current;
      nodeEls.current = new Map();
      if (world)
        for (const el of world.querySelectorAll<HTMLElement>("[data-node-id]"))
          nodeEls.current.set(String(el.dataset.nodeId), el);
    }
    const still = advanceMotion(ms, dt);
    for (const [id, m] of ms) {
      const el = nodeEls.current.get(id);
      if (!el) continue;
      el.style.transform = motionTransform(m);
      el.style.filter = m.a >= 1 ? "" : `opacity(${m.a})`;
      // A card on its way out is already gone as far as the graph is concerned.
      el.style.pointerEvents = m.at === 0 ? "none" : "";
      styled.current.add(id);
    }
    for (const id of styled.current) {
      if (ms.has(id)) continue;
      clearMotionStyle(nodeEls.current.get(id));
      styled.current.delete(id);
    }
    // The cables follow for free, and `rebuildCables` is the one place that decides — docs/nodeMotion.md.
    rebuildCables.current();
    return still;
  };

  // The cable draws for one frame of a move, from the interpolated positions — docs/nodeMotion.md.
  const motionCables = useRef<() => CableDraw[]>(() => []);
  motionCables.current = () => {
    const ms = motions.current;
    const drag = nodeDrag.current;
    const byId = new Map<string, GraphNode>();
    for (const n of layoutNodes.current) {
      const p = motionPos(n, ms);
      let { x, y } = p;
      // A card in hand (or dropped, pending its reload) is wherever the hand put it.
      if (drag && n.id === drag.n.id) {
        x = n.x + drag.dx;
        y = n.y + drag.dy;
      } else {
        const dropped = droppedNodes.current.get(n.id);
        if (dropped) {
          x = n.x + dropped.dx;
          y = n.y + dropped.dy;
        }
      }
      byId.set(n.id, x === n.x && y === n.y ? n : { ...n, x, y });
    }
    const draws: CableDraw[] = [];
    const lifted = patchRef.current?.edge?.id;
    // The fade has to hold through a slide too, or every cable snaps to full while cards move.
    const anyOpen = graph.nodes.some((n) => n.assemblyOf?.open);
    for (const e of graph.edges) {
      if (e.id === lifted) continue; // its end is in hand — the dashed ghost draws it
      // The automation cables move too: a curve is a node, and its cables are cables.
      if (e.automation) {
        const a = autoTarget(e, byId);
        if (!a) continue;
        const base = hangPoints(a.from, a.to);
        const sway = swayFor(a.id);
        exciteSway(sway, base[0], base[base.length - 1]);
        draws.push({
          geom: { base, samples: NO_SAMPLES, len: 0 },
          color: MAUVE,
          flow: 0,
          sway,
          width: AUTO_W,
          shadowWidth: AUTO_SHADOW_W,
          dash: AUTO_DASH,
          arrowSize: AUTO_ARROW,
        });
        continue;
      }
      if (e.points.length < 2) continue;
      const base = cablePath(e, byId.get(e.source), byId.get(e.target));
      if (base.length < 2) continue;
      // Every motion frame re-reads the sockets, so the slack trails the cards through a slide.
      const sway = swayFor(e.id);
      exciteSway(sway, base[0], base[base.length - 1]);
      draws.push({
        geom: { base, samples: NO_SAMPLES, len: 0 },
        color: cableColorFor(e.signal),
        flow: 0,
        sway,
        ...(anyOpen && !e.assembly ? { alpha: FOREIGN_ALPHA } : {}),
      });
    }
    return draws;
  };

  /** Everything lands: styles off, ghosts unmounted, the real cable geometry back. */
  const settleMotion = useRef<() => void>(NOOP);
  settleMotion.current = () => {
    motions.current.clear();
    for (const id of styled.current) clearMotionStyle(nodeEls.current.get(id));
    styled.current.clear();
    drawn.current = settledDrawn();
    cablesSvg.current?.classList.remove("moving");
    if (ghostCount.current) setGhosts(EMPTY_GHOSTS);
    // Back to the baked geometry — resampled, and rippling again wherever signal runs.
    applyLive.current();
  };

  // A new layout, and its first frame now — a LAYOUT effect, which is the FLIP rule, docs/nodeMotion.md.

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs above were reassigned with this render's layout, so `graph` IS the trigger and the body reads nothing else.
  useLayoutEffect(() => {
    // A new layout retires every dropped card's inline transform, its left/top now carrying it.
    if (droppedNodes.current.size) {
      for (const { el } of droppedNodes.current.values())
        el.style.transform = "";
      droppedNodes.current.clear();
    }
    if (!animate) {
      // Turned off mid-flight — nothing else would ever take the inline styles back off.
      if (motions.current.size || styled.current.size) settleMotion.current();
      drawn.current = settledDrawn();
      return;
    }
    // The FIRST layout is not a change, and the cap is a screen and a half in WORLD px — docs/nodeMotion.md.
    const host = hostRef.current;
    const travel = host
      ? (Math.hypot(host.clientWidth, host.clientHeight) * 1.5) /
        Math.max(cam.current.k, 0.01)
      : Number.POSITIVE_INFINITY;
    const plan = drawn.current.size
      ? planMotion(drawn.current, motions.current, graph.nodes, travel)
      : null;
    drawn.current = settledDrawn();
    if (!plan?.moving) {
      // Nothing to do — but something from the layout before this one may still be in flight.
      if (motions.current.size || styled.current.size) settleMotion.current();
      return;
    }
    for (const g of plan.ghosts) drawn.current.set(g.node.id, g);
    motions.current = plan.motions;
    rebind.current = true;
    setGhosts((cur) => (sameGhosts(cur, plan.ghosts) ? cur : plan.ghosts));
    // The stale half of the drawing steps aside for the move — see the `.dgx-cables` rule.
    cablesSvg.current?.classList.add("moving");
    // dt 0: place the offsets, advance nothing.
    motionStep.current(0);
    // …and look again next frame: the ghosts are not in the DOM until the state update lands.
    rebind.current = true;
    kick.current();
  }, [graph, animate]);

  // --- what carries signal: refs, not state, so a crossing re-renders nothing (docs/liveCables.md) ---
  const hostStore = useEngineStoreOrNull();
  const liveRef = useRef<Map<string, number>>(EMPTY_LIVE);
  // What each lane is PUTTING OUT, per kind of wire — the seed the walk seeds from, and the
  // reason a cable's ripple says how loud rather than merely whether. See docs/liveCables.md.
  const seedRef = useRef<Map<string, NodeFlow>>(EMPTY_SEEDS);
  const cableDrawsRef = useRef<CableDraw[]>([]);
  const rebuildCables = useRef<() => void>(NOOP);
  const applyLive = useRef<() => void>(NOOP);
  // …and its cheap half, for the frames where only the LEVELS moved.
  const applyFlow = useRef<() => void>(NOOP);
  // Assigned every render like `applyLive`, so the walk always sees the CURRENT edges: the meter
  // effect below mounts once and would otherwise close over the graph as it was then.
  const applyMeter = useRef<(seeds: Map<string, NodeFlow>) => void>(NOOP1);
  // Set by the ripple effect below; poked whenever liveness changes, to start a stopped loop.
  const rippleRef = useRef<() => void>(NOOP);
  // One swing per cable, keyed by edge id and SHARED with the draws, so settling rebuilds nothing.
  const sways = useRef(new Map<string, CableSway>());
  const swayKick = useRef<() => void>(NOOP);
  const swayFor = (id: string): CableSway => {
    let s = sways.current.get(id);
    if (!s) {
      s = newSway();
      sways.current.set(id, s);
    }
    return s;
  };

  // --- the cable canvas: its width comes from the LOD, which QUANTISES it (docs/camera.md) ---
  const linkBoost = lod.boost;

  // Reassigned every render, like `paint` and `fit`, so it always sees the CURRENT edges.
  rebuildCables.current = () => {
    // Mid-move the laid-out geometry is a lie, and so is a HELD card's — docs/nodeMotion.md.
    if (motions.current.size || nodeDrag.current || droppedNodes.current.size) {
      cableDrawsRef.current = motionCables.current();
      swayKick.current();
      return;
    }
    const live = liveRef.current;
    // The cable whose end is in hand steps aside: its dashed ghost is the drawing of it.
    const lifted = patchRef.current?.edge?.id;
    cableDrawsRef.current = [
      ...model.signal
        .filter((g) => g.id !== lifted)
        .map((g) => {
          // Excitation happens HERE, where the endpoints are read, so only a moved socket swings.
          const sway = swayFor(g.id);
          exciteSway(sway, g.base[0], g.base[g.base.length - 1]);
          return {
            id: g.id,
            geom: g,
            color: cableColorFor(g.signal),
            flow: live.get(g.id) ?? 0,
            sway,
            ...(g.faded ? { alpha: FOREIGN_ALPHA } : {}),
          };
        }),
      // The automation cables, same physics, wearing the auto dress — a cable is a cable.
      ...model.autoGeom.map((g): CableDraw => {
        const sway = swayFor(g.id);
        exciteSway(sway, g.base[0], g.base[g.base.length - 1]);
        return {
          geom: g,
          color: MAUVE,
          flow: 0,
          sway,
          width: AUTO_W,
          shadowWidth: AUTO_SHADOW_W,
          dash: AUTO_DASH,
          arrowSize: AUTO_ARROW,
        };
      }),
    ];
    // Springs for cables that left go with them, or a rewired graph accumulates ghosts.
    const total = model.signal.length + model.autoGeom.length;
    if (sways.current.size > total) {
      const keep = new Set([
        ...model.signal.map((g) => g.id),
        ...model.autoGeom.map((g) => g.id),
      ]);
      for (const id of sways.current.keys())
        if (!keep.has(id)) sways.current.delete(id);
    }
    swayKick.current();
  };
  /** A meter frame moves the NUMBERS and nothing else: rebuilding would re-excite every spring
   *  twenty times a second, and reallocate the array with it. See docs/liveCables.md. */
  applyFlow.current = () => {
    const live = liveRef.current;
    let moved = false;
    for (const c of cableDrawsRef.current) {
      const f = (c.id && live.get(c.id)) || 0;
      if (c.flow === f) continue;
      c.flow = f;
      moved = true;
    }
    if (!moved) return;
    paintRef.current();
    rippleRef.current();
  };

  applyMeter.current = (seeds) => {
    seedRef.current = seeds;
    liveRef.current = computeFlow(model.signal, seeds, model.foldedAt);
    applyFlow.current();
  };

  // The flow map is keyed by EDGE, so a graph change goes through here too, not just a meter frame.
  applyLive.current = () => {
    liveRef.current = computeFlow(
      model.signal,
      seedRef.current,
      model.foldedAt,
    );
    rebuildCables.current();
    paintRef.current();
    rippleRef.current();
  };

  const cvRef = useRef<HTMLCanvasElement>(null);
  const scratch = useRef(newScratch()).current;
  const phase = useRef(0);
  // The host's size, from the ResizeObserver below: reading it in the draw would flush style per frame.
  const hostSize = useRef({ w: 0, h: 0 });
  // Reassigned every render, like `fit` below, so the rAF always draws the CURRENT camera and cables.
  paintRef.current = () => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(hostSize.current.w * dpr);
    const height = Math.round(hostSize.current.h * dpr);
    if (!width || !height) return;
    // Resizing the backing store also clears it, so only do it when it actually changed.
    if (cv.width !== width || cv.height !== height) {
      cv.width = width;
      cv.height = height;
    }
    drawCables(
      ctx,
      {
        width,
        height,
        // `cam.current`, not `cam`: the camera is a REF, mutated in place by the frame loop.
        cam: cam.current,
        dpr,
        cables: cableDrawsRef.current,
        phase: phase.current,
        boost: linkBoost,
      },
      scratch,
    );
  };

  // A graph or LOD change redraws AT ONCE so canvas and nodes land together; the CAMERA never does.

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the frame's inputs, not values this body reads — the refs above were reassigned with them during the render, so listing them here IS the redraw trigger.
  useLayoutEffect(() => {
    applyLive.current();
  }, [model.signal, linkBoost]);

  // The ripple, on its own clock at WOBBLE_HZ, mounted ONCE and steered by `liveRef`.
  useEffect(() => {
    let raf = 0;
    let lastAt = 0;
    const step = 1000 / WOBBLE_FPS;
    const tick = (now: number) => {
      if (liveRef.current.size === 0) {
        raf = 0; // nothing carries signal any more: stop, and let `sync` restart us
        return;
      }
      raf = requestAnimationFrame(tick);
      if (now - lastAt < step) return;
      // By REAL elapsed time, not by a fixed increment, so capping the rate slows nothing down.
      phase.current += Math.PI * 2 * WOBBLE_HZ * ((now - lastAt) / 1000);
      lastAt = now;
      paintRef.current();
    };
    const sync = () => {
      if (raf || liveRef.current.size === 0) return;
      lastAt = performance.now();
      raf = requestAnimationFrame(tick);
    };
    rippleRef.current = sync;
    sync();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      rippleRef.current = NOOP;
    };
  }, []);

  // The SWING's clock, beside the ripple's: kicked by every rebuild, and a kick while running is a no-op.
  useEffect(() => {
    let raf = 0;
    let lastAt = 0;
    const tick = (now: number) => {
      // Capped dt: a background tab's first frame back would otherwise integrate seconds at once.
      const dt = Math.min(0.05, (now - lastAt) / 1000);
      lastAt = now;
      let moving = false;
      for (const s of sways.current.values())
        if (stepSway(s, dt)) moving = true;
      paintRef.current();
      raf = moving ? requestAnimationFrame(tick) : 0;
    };
    swayKick.current = () => {
      if (raf) return;
      lastAt = performance.now();
      raf = requestAnimationFrame(tick);
    };
    return () => {
      if (raf) cancelAnimationFrame(raf);
      swayKick.current = NOOP;
    };
  }, []);

  // The meters straight off the store, and the PICTURE on the same frame — docs/liveCables.md.
  useEffect(() => {
    if (!hostStore) return;
    const order = trackOrder ?? EMPTY_ORDER;
    const spans = videoSpans;
    const read = (): void => {
      const s = hostStore.getSnapshot();
      const showing =
        spans && s.playing ? liveVideoLanes(spans, s.playhead) : EMPTY_ORDER;
      const lanes: Record<string, LaneSource> = {};
      for (let i = 0; i < order.length; i++) {
        const id = order[i];
        const notes = noteLanes?.[id];
        lanes[id] = {
          db: s.levels[i],
          ...(notes
            ? {
                notes: {
                  load: noteLoadAt(notes.spans, s.playhead),
                  peak: notes.peak,
                },
              }
            : {}),
        };
      }
      for (const id of showing) lanes[id] = { ...lanes[id], showing: true };
      const seeds = seedFlows(lanes);
      if (seedsEq(seeds, seedRef.current)) return;
      seedRef.current = seeds;
      applyMeter.current(seeds);
    };
    read();
    return hostStore.subscribe(read);
  }, [hostStore, trackOrder, videoSpans, noteLanes]);

  // --- fit: frame the whole graph to the host; it ANSWERS whether it did (docs/camera.md) ---
  const fit = useRef<() => boolean>(() => false);
  fit.current = () => {
    const host = hostRef.current;
    // isFinite, not truthy: an empty dagre layout reported -Infinity and still marked the view framed over nothing.
    if (
      !host ||
      !Number.isFinite(graph.width) ||
      !Number.isFinite(graph.height)
    )
      return false;
    // The BOX, not the extent: a pin may sit above the first track or left of it — docs/hosting.md.
    const gw = graph.width - graph.left;
    const gh = graph.height - graph.top;
    if (!gw || !gh) return false;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return false;
    const pad = 0.9;
    // "height" frames the HEIGHT and lets the width run off the side, which is pannable — docs/camera.md.
    const k = clampZoom(
      fitAxis === "height"
        ? (sh / gh) * pad
        : Math.min((sw / gw) * pad, (sh / gh) * pad),
    );
    // Framed, so from here the camera is worth remembering — `place` persists it.
    fitted.current = true;
    place({
      k,
      // Height-fitted content overflows, so it is pinned LEFT and each offset carries the box's corner.
      x:
        (fitAxis === "height" && gw * k > sw ? 0 : (sw - gw * k) / 2) -
        graph.left * k,
      y: (sh - gh * k) / 2 - graph.top * k,
    });
    return true;
  };
  // Frame once, and again only when `fitKey` says this is a different graph. See docs/chainsGraph.md.
  const lastFitKey = useRef(fitKey);
  useLayoutEffect(() => {
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey;
      fitted.current = false;
    }
    if (!fitted.current) fitted.current = fit.current();
  }, [graph, fitKey]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Only until the first successful fit: the host starts at zero size, but later resizes must not re-frame.
    const ro = new ResizeObserver(([entry]) => {
      // The cable canvas is sized from here: not being in the flow, nothing else would tell it.
      const box = entry?.contentRect;
      if (box) hostSize.current = { w: box.width, h: box.height };
      paintRef.current();
      // Keep re-framing while the camera is still ours — the host settles for a while after the first fit.
      if (userMoved.current) return;
      if (fit.current()) fitted.current = true;
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // --- fitTo: frame a subset of nodes (chain selection from the sidebar) ---------
  const fitTo = useRef<FitToFn>(() => false);
  fitTo.current = (nodes: GraphNode[], opts: FitToOpts = {}) => {
    const { panOnly, axis = "both", zoom = 1 } = opts;
    const host = hostRef.current;
    if (!host || !nodes.length) return false;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return false;
    // Framing a chain the user picked is their choice too — AFTER the size checks, so a no-op claims nothing.
    userMoved.current = true;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const bw = maxX - minX;
    const bh = maxY - minY;
    const pad = 0.9;
    const k = clampZoom(
      (axis === "height"
        ? (sh / bh) * pad
        : Math.min((sw / bw) * pad, (sh / bh) * pad)) * zoom,
    );
    if (panOnly) {
      // Keep the zoom from the chain fit; only adjust translation to center the target.
      const cur = cam.current;
      place({
        k: cur.k,
        x: sw / 2 - (panOnly.x + panOnly.w / 2) * cur.k,
        y: sh / 2 - (panOnly.y + panOnly.h / 2) * cur.k,
      });
    } else {
      // Centred, EXCEPT a row that does not fit across — see `frameOriginX`, docs/camera.md.
      const spills = axis === "height" && bw * k > sw;
      const originX = frameOriginX(sw, bw * k, pad, spills);
      place({
        k,
        x: originX - minX * k,
        y: (sh - bh * k) / 2 - minY * k,
      });
    }
    return true;
  };
  useEffect(() => {
    // One options object forwarded whole, because it cannot be half-forwarded by accident.
    onCamReady?.({
      fitTo: (nodes, opts) => fitTo.current(nodes, opts),
      get: () => ({ ...cam.current }),
      // Placed outright, no glide: putting a camera BACK is not a gesture to animate.
      set: (c) => {
        userMoved.current = true;
        place(c);
      },
    });
  }, [onCamReady]);

  // --- reconcile optimistic overrides as fresh engine/track frames arrive ------------
  const drag = useRef<{
    node: GraphNode;
    w: WebWidget;
    tgt: WidgetTarget;
    key: string;
    startT: number;
    startY: number;
    travel: number; // screen px that sweep the whole range for THIS control
    value: number;
    sent: boolean;
  } | null>(null);
  const overrideRef = useRef(override);
  overrideRef.current = override;
  useEffect(() => {
    // A plugin frame landed: drop the overrides it now speaks for, keeping the one under the hand.
    return params.subscribe(() => {
      if (!hasChannel(overrideRef.current, "p:")) return;
      setOverride((o) => dropChannel(o, "p:", drag.current?.key));
    });
  }, [params]);
  useEffect(() => {
    setOverride((o) => dropChannel(o, "o:", drag.current?.key));
  }, [moduleParams]);
  useEffect(() => {
    setOverride((o) => dropChannel(o, "t:", drag.current?.key));
  }, [trackControls]);

  // Either prop turns the channel on: a host may only SHOW such a value, or only take one.
  const offlineChannel =
    moduleParams !== undefined || onModuleParam !== undefined;
  const pluginWritable = setPluginParam !== undefined;
  // Either one: a host that wired the toggles or the two continuous controls meant it.
  const trackWritable = onTrackSet !== undefined || onTrackToggle !== undefined;
  const offlineWritable = onModuleParam !== undefined;
  const rackTriggerable = onTriggerRack !== undefined;
  const recorderWired = onRecorder !== undefined;
  const projectWritable = onProjectField !== undefined;
  // Memoised on VALUES, never on the host's callbacks, which are often inline lambdas.
  const ch = useMemo<Channels>(
    () => ({
      params,
      trackControls: trackControls ?? {},
      override,
      trackOrder: trackOrder ?? EMPTY_ORDER,
      moduleParams: moduleParams ?? {},
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
      rackTriggerable,
      recorderWired,
      projectWritable,
      rehearsal: !!rehearsal,
      rackLit,
    }),
    [
      params,
      trackControls,
      override,
      trackOrder,
      moduleParams,
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
      rackTriggerable,
      recorderWired,
      projectWritable,
      rehearsal,
      rackLit,
    ],
  );

  // Through a ref, assigned every render, so every handler binds once and a memoised Node sees no new prop.
  const chRef = useRef(ch);
  chRef.current = ch;
  // Likewise for the window listeners, which are bound once and would hold the binding render's value.
  const rehearsalRef = useRef(false);
  rehearsalRef.current = !!rehearsal;
  const selRef = useRef(selected);
  selRef.current = selected;

  // --- widget drag (knob/slider/number): live sends coalesced, commit on release ------
  const beginDrag = useCallback(
    (n: GraphNode, w: WebWidget, e: React.PointerEvent) => {
      const ch = chRef.current;
      e.stopPropagation(); // don't select the node or start a pan
      // A frozen MODULE has no plugin in the engine; a frozen LANE carries its own controls.
      if (n.frozen && n.kind === "module") return;
      // An AUTOMATIC freeze gives way instead: thawed first, so the drag reaches a live plugin.
      if (n.autoFrozen) cb.current.onThawAutoFreeze?.(n.autoFrozen);
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      const v = widgetValue(n, w, ch);
      drag.current = {
        node: n,
        w,
        tgt,
        key: targetKey(tgt),
        startT: v === undefined ? 0 : widgetNorm(w, v),
        startY: e.clientY,
        // A fader sweeps over its OWN throw, measured off the rail — docs/widgets.md.
        travel:
          w.type === "fader"
            ? Math.max(
                40,
                (e.currentTarget as HTMLElement).querySelector(".rail")
                  ?.clientHeight ?? DRAG_TRAVEL_PX,
              )
            : DRAG_TRAVEL_PX,
        value: v ?? widgetDenorm(w, 0),
        sent: false,
      };
    },
    [],
  );

  // Global pointer handling — pan, widget drag, gesture settle. Bound once; a movement threshold gates selection.
  const pan = useRef<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    moved: number;
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (d) {
        const dy = (d.startY - e.clientY) / d.travel;
        const t = d.startT + dy * (e.shiftKey ? DRAG_FINE : 1);
        const value = widgetDenorm(d.w, t);
        if (value === d.value) return;
        d.value = value;
        setOverride((o) => ({ ...o, [d.key]: value }));
        // Coalesce to one live send per frame; only a plugin param feeds live (a track knob persists on release).
        if (!d.sent && (d.tgt.kind === "plugin" || d.tgt.kind === "offline")) {
          d.sent = true;
          requestAnimationFrame(() => {
            const cur = drag.current;
            if (!cur) return;
            cur.sent = false;
            if (cur.tgt.kind === "plugin")
              cb.current.setPluginParam?.(
                cur.tgt.pluginId,
                cur.tgt.name,
                cur.value,
              );
            // An offline module has no socket, so this reaches the surface that REALISES it.
            else if (cur.tgt.kind === "offline")
              cb.current.onModuleParam?.(
                cur.tgt.module,
                cur.tgt.name,
                cur.value,
              );
          });
        }
        return;
      }
      const p = pan.current;
      if (!p) return;
      const nx = e.clientX - p.sx;
      const ny = e.clientY - p.sy;
      p.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (p.moved > DRAG_SLOP) {
        setPanning(true);
        setHovered(null);
        userMoved.current = true; // the camera is theirs now — stop auto-framing
        // Both axes and no glide, unless the graph is a ROW — docs/camera.md.
        cam.current.x = goal.current.x = p.cx + nx;
        if (!rowRef.current) cam.current.y = goal.current.y = p.cy + ny;
        kick.current();
      }
    };
    const up = () => {
      const d = drag.current;
      if (d) {
        drag.current = null;
        if (d.tgt.kind === "track") {
          if (d.tgt.control === "volume" || d.tgt.control === "pan")
            cb.current.onTrackSet?.(d.tgt.trackId, d.tgt.control, d.value);
          // A module FIELD is a named setting, not a range, so a drag onto one commits nothing.
        } else if (
          d.tgt.kind === "plugin" &&
          d.node.module &&
          !rehearsalRef.current
        ) {
          // Not in a rehearsal: this line WRITES the value into the module's file — docs/hosting.md.
          cb.current.command(
            `node param ${d.node.module} ${JSON.stringify(d.tgt.name)} ${d.value}`,
          );
        }
        // The override stays until the matching frame arrives (see the reconcile effects).
      }
      if (pan.current) {
        suppressClick.current = pan.current.moved > DRAG_SLOP;
        pan.current = null;
        setPanning(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // Grabbing the canvas ends any zoom still in flight: you are steering now — docs/camera.md.
    goal.current.k = cam.current.k;
    pan.current = {
      sx: e.clientX,
      sy: e.clientY,
      cx: cam.current.x,
      cy: cam.current.y,
      moved: 0,
    };
  };

  // The camera loop, the wheel and the pinch, bound once and writing only refs — docs/camera.md.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let last = 0;
    const step = (t: number) => {
      // Clamped: a backgrounded tab hands back one enormous dt, which would land the glide at once.
      const dt = last ? Math.min(100, t - last) : 16;
      last = t;
      const c = cam.current;
      const g = goal.current;
      let moving = pan.current != null;
      // The cards, before the camera: `motionStep` rebuilds the cable draws for this frame.
      if (motions.current.size) {
        const still = motionStep.current(dt);
        moving = moving || still;
        if (!still) settleMotion.current();
      }
      if (c.k !== g.k) {
        // Within a thousandth of the goal, land on it — an exponential never quite arrives.
        const near = Math.abs(g.k - c.k) <= c.k * 1e-3;
        const k = near ? g.k : c.k + (g.k - c.k) * approach(dt);
        Object.assign(c, zoomAbout(c, k, anchor.current.px, anchor.current.py));
        Object.assign(g, { x: c.x, y: c.y });
        moving = moving || !near;
      }
      applyCam(worldRef.current, c);
      paintRef.current(); // the canvas is outside `.dgx-world`, so the transform misses it
      const next = lodFor(c.k);
      if (!sameLod(next, lodRef.current)) {
        lodRef.current = next;
        setLod(next);
      }
      if (moving) raf = requestAnimationFrame(step);
      else {
        raf = 0;
        last = 0;
        persistRef.current(); // settled — this is the camera worth remembering
      }
    };
    kick.current = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(step);
      }
    };
    // Non-passive: it must preventDefault, and a React onWheel would allocate an event per notch.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true; // either way, the camera is theirs now — stop auto-framing
      if (rowRef.current) {
        // A ROW is read across: the wheel walks along it, whatever axis the device reports.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k;
        c.x = g.x =
          g.x -
          wheelPixels(e.deltaX || e.deltaY, e.deltaMode, host.clientWidth);
      } else if (isZoomWheel(e) || isMouseWheel(e)) {
        const r = host.getBoundingClientRect();
        anchor.current = { px: e.clientX - r.left, py: e.clientY - r.top };
        // Multiplied onto the GOAL, and `e.ctrlKey` marks a PINCH with its own rate — docs/camera.md.
        goal.current.k = clampZoom(
          goal.current.k *
            wheelFactor(e.deltaY, e.deltaMode, host.clientHeight, e.ctrlKey),
        );
      } else {
        // Two fingers on a SURFACE: the camera moves WITH them, 1:1 and with no glide, in screen px.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k; // a slide takes over from any zoom still in flight, as a pointer-down does
        c.x = g.x = g.x - wheelPixels(e.deltaX, e.deltaMode, host.clientWidth);
        c.y = g.y = g.y - wheelPixels(e.deltaY, e.deltaMode, host.clientHeight);
      }
      kick.current();
    };
    host.addEventListener("wheel", wheel, { passive: false });

    // Two fingers where there is no wheel at all — TOUCH events, and absolute, docs/camera.md.
    let pinch: { dist: number; k: number; x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pan.current = null; // a pinch is not a pan, whatever the first finger had started
      setPanning(false);
      pinch = { dist: spreadOf(e.touches[0], e.touches[1]), ...cam.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spreadOf(e.touches[0], e.touches[1]);
      if (d <= 0) return;
      const r = host.getBoundingClientRect();
      const px = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const py = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      userMoved.current = true;
      const k = clampZoom(pinch.k * pinchFactor(pinch.dist, d));
      // From the gesture's OWN starting camera, which is what makes the whole pinch absolute.
      Object.assign(cam.current, zoomAbout(pinch, k, px, py));
      Object.assign(goal.current, cam.current);
      kick.current();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    host.addEventListener("touchstart", onTouchStart, { passive: false });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);

    return () => {
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // --- node + widget actions ---------------------------------------------------------
  const tapNode = useCallback((n: GraphNode) => {
    if (suppressClick.current) return; // that click ended a pan
    const selected = selRef.current;
    cb.current.onPickModule?.(n.kind === "module" ? (n.module ?? null) : null);
    if (n.kind === "module" && n.module) {
      cb.current.onSelect(selected === n.module ? null : n.module);
    } else if (n.chain) {
      cb.current.onSelect(selected === n.chain ? null : n.chain);
    }
  }, []);
  const contextNode = useCallback((n: GraphNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ctx = nodeToCtx(n);
    if (ctx) cb.current.onContextMenu?.(ctx, e.clientX, e.clientY);
  }, []);
  // Right-click on a CONTROL: the menu for the PLUGIN param it drives, and only that — docs/widgets.md.
  const contextParam = useCallback(
    (n: GraphNode, w: WebWidget, x: number, y: number): void => {
      if (!n.module || !w.bind || w.bind.startsWith("@") || !n.pluginId) return;
      cb.current.onContextMenu?.(
        {
          kind: "param",
          id: n.module,
          param: w.bind,
          label: w.label || w.bind,
          cc: n.cc?.[w.bind],
        },
        x,
        y,
      );
    },
    [],
  );
  // The plugin's OWN window: the verb names an INSTANCE, since a window belongs to what is loaded.
  // Which VST's render holds each node, by module — so the plugin bubble can thaw it first.
  const autoFrozenOf = useRef<Record<string, string>>({});
  autoFrozenOf.current = Object.fromEntries(
    graph.nodes.flatMap((n) =>
      n.module && n.autoFrozen ? [[n.module, n.autoFrozen]] : [],
    ),
  );
  const openPlugin = useCallback((module: string) => {
    // A baked VST has no window to open: thaw its freeze, then ask.
    const at = autoFrozenOf.current[module];
    if (at) cb.current.onThawAutoFreeze?.(at);
    void cb.current.command(`node external-ui ${module}`);
  }, []);
  // Bare `node bypass` toggles, and NOT the quiet path: bypass changes the graph's shape, so it must reload.
  const bypassModule = useCallback(
    (module: string) => cb.current.onBypassModule?.(module),
    [],
  );
  // The node only ASKS: a viewport-positioned overlay is the shell's to render — docs/hosting.md.
  const openNodeMenu = useCallback(
    (n: GraphNode, at: { x: number; y: number }) =>
      cb.current.onNodeMenu?.(n, at),
    [],
  );
  // The widget only ASKS, and the shell writes what comes back — an asset loads at BUILD time.
  const pickAsset = useCallback(
    (n: GraphNode, param: string, x: number, y: number) => {
      if (n.module) cb.current.onAssetBrowse?.(n.module, param, x, y);
    },
    [],
  );
  // What feeds a track: the list is the MACHINE's — its interface, its channel labels.
  const pickTrackInput = useCallback((n: GraphNode, x: number, y: number) => {
    cb.current.onPickTrackInput?.(n.label, x, y);
  }, []);
  // Commit a module FIELD into its own file — no optimism and no socket, docs/widgets.md.
  const setModuleField = useCallback(
    (
      // The whole target, not just its two names: a rehearsal keys its override by it.
      w: WebWidget,
      tgt: { kind: "module"; module: string; field: string },
      value: number,
    ) => {
      const opt = w.options?.find((o) => o.value === value);
      if (!opt) return; // a field with no named settings — nothing to write
      // A rehearsal shows the pick and writes nothing, so the override is all that can answer.
      if (rehearsal) {
        setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
        return;
      }
      // `arg` where the entry SAYS one thing and SETS another, and the field is named as the WIDGET does.
      const line = `node param ${tgt.module} @${tgt.field} ${opt.arg ?? opt.label}`;
      // The RELOADING sender when the host wired one: this control shows the file and nothing else,
      // so a command that brings no graph back leaves it on the old value. See docs/widgets.md.
      void (cb.current.onModuleField ?? cb.current.command)(line);
    },
    [rehearsal],
  );

  // A dropdown's chosen setting: the same commit path as a toggle, but the value is the option's, not a flip.
  const pickWidget = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      const tgt = widgetTarget(n, w, chRef.current.offlineChannel);
      // A track intrinsic has no named settings, and a pad and a recorder button no value at
      // all: none of the three can be SET here.
      if (
        !tgt ||
        tgt.kind === "track" ||
        tgt.kind === "rack" ||
        tgt.kind === "recorder"
      )
        return;
      if (tgt.kind === "module") {
        setModuleField(w, tgt, value);
        return;
      }
      if (tgt.kind === "offline") {
        setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
        cb.current.onModuleParam?.(tgt.module, tgt.name, value);
        return;
      }
      // A PROJECT setting travels as the option's WORD, not its index: `project aspect 16:9` is
      // what a person would type, and the row's position is this card's business alone.
      if (tgt.kind === "project") {
        const opt = w.options?.find((o) => o.value === value);
        if (opt) cb.current.onProjectField?.(tgt.field, opt.arg ?? opt.label);
        return;
      }
      setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
      cb.current.setPluginParam?.(tgt.pluginId, tgt.name, value);
      if (n.module && !rehearsal)
        cb.current.command(
          `node param ${n.module} ${JSON.stringify(tgt.name)} ${value}`,
        );
    },
    [setModuleField, rehearsal],
  );

  const tapWidget = useCallback(
    (n: GraphNode, w: WebWidget) => {
      const ch = chRef.current;
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      if (tgt.kind === "track") {
        // Mute/solo/arm: no optimism, so a rapid double-click can't leave the button inverted against the file.
        if (
          tgt.control === "mute" ||
          tgt.control === "solo" ||
          tgt.control === "arm"
        )
          cb.current.onTrackToggle?.(tgt.trackId, tgt.control);
        return;
      }
      // A RECORDER's button fires and is done, exactly as a pad does: no optimistic value, since
      // the state frame answers at 20 Hz and a light that lied about a refusal is worse.
      if (tgt.kind === "recorder") {
        cb.current.onRecorder?.(tgt.verb, {
          module: tgt.module,
          pluginId: tgt.pluginId,
        });
        return;
      }
      // A RACK pad fires its sound and is done: no override to place, nothing to commit.
      if (tgt.kind === "rack") {
        cb.current.onTriggerRack?.(tgt.module, tgt.symbol);
        return;
      }
      // A project setting is a dropdown and is PICKED, never flipped — see `pickWidget`.
      if (tgt.kind === "project") return;
      // A module field cycles through its own named settings — there is no 0/1 to flip.
      if (tgt.kind === "module") {
        const opts = w.options ?? [];
        const at = opts.findIndex((o) => o.value === widgetValue(n, w, ch));
        const next = opts[(at + 1) % (opts.length || 1)];
        if (next) setModuleField(w, tgt, next.value);
        return;
      }
      // A plugin toggle has no such round-trip: set it 0/1 down the socket, optimistically, and commit at once.
      const cur = widgetValue(n, w, ch);
      const on = cur !== undefined && widgetNorm(w, cur) >= 0.5;
      const next = widgetDenorm(w, on ? 0 : 1);
      setOverride((o) => ({ ...o, [targetKey(tgt)]: next }));
      if (tgt.kind === "offline") {
        cb.current.onModuleParam?.(tgt.module, tgt.name, next);
        return;
      }
      cb.current.setPluginParam?.(tgt.pluginId, tgt.name, next);
      if (n.module && !rehearsal)
        cb.current.command(
          `node param ${n.module} ${JSON.stringify(tgt.name)} ${next}`,
        );
    },
    [setModuleField, rehearsal],
  );
  const insert = useCallback(
    (info: EdgeInsert, x: number, y: number, at: { x: number; y: number }) => {
      if (suppressClick.current) return;
      cb.current.onEdgeInsert?.(info, x, y, at);
    },
    [],
  );

  // --- the patch cable: one loose end, landing on connect or replug (docs/hosting.md) ---
  const [patch, setPatch] = useState<{
    /** WHAT is being drawn, because the three cables land on different things — docs/hosting.md. */
    kind?: "signal" | "automation" | "event";
    /** The curve this cable belongs to, on both of the two that involve one. */
    curve?: { curve: string; module?: string; param?: string };
    type: WebSignal;
    seeking: "in" | "out"; // which side of a jack lands the loose end
    fixedRef: string; // the plugged end's chains address
    fixedNode: string; // …the node it is ON, which is the one jack gating must NOT offer
    fixedAt: { x: number; y: number }; // …and its socket, where the temp cable is pinned
    // The arrow this WAS, when an existing cable was lifted — absent for a new one.
    edge?: { id: string; from: string; to: string };
  } | null>(null);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const patchEl = useRef<SVGPathElement | null>(null);
  // The laid-out graph, in a ref, so `tapJack` stays stable while reading the current layout.
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // Screen → world, the inverse of the camera `applyCam` writes — the one place that needs it.
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = hostRef.current?.getBoundingClientRect();
    const c = cam.current;
    return {
      x: (cx - (r?.left ?? 0) - c.x) / c.k,
      y: (cy - (r?.top ?? 0) - c.y) / c.k,
    };
  }, []);

  /** The dashed promise HANGS like the cable it becomes; `f` is always the OUT end. */
  const patchD = (f: { x: number; y: number }, t: { x: number; y: number }) =>
    smoothPath(hangPoints(f, t));

  // The ref is written before the state lands, because `rebuildCables` reads the ref.
  const setPatchNow = (next: typeof patchRef.current): void => {
    patchRef.current = next;
    setPatch(next);
    rebuildCables.current();
    paintRef.current();
  };

  // The socket THIS press armed from, so its own release lands nothing; cleared by every release.
  const armedFrom = useRef<string | null>(null);

  /** The loose end went into `p`: a lifted cable moves one of its ends, a new one is drawn. */
  const landPatch = (
    cur: NonNullable<typeof patchRef.current>,
    n: GraphNode,
    p: Jack,
  ): void => {
    const landed = jackRef(n, p.name);
    if (cur.edge) {
      const nf = cur.seeking === "out" ? landed : cur.edge.from;
      const nt = cur.seeking === "in" ? landed : cur.edge.to;
      cb.current.onReplug?.(cur.edge.from, cur.edge.to, nf, nt);
    } else {
      cb.current.onConnect?.(cur.fixedRef, landed);
    }
    setPatchNow(null);
  };

  // The three halves of the two curve cables, committing through ONE callback — docs/hosting.md.
  const startAutomation = useCallback((n: GraphNode) => {
    suppressClick.current = false;
    if (!n.curveOf) return;
    setPatchNow({
      kind: "automation",
      curve: n.curveOf,
      type: "event", // mauve, and never type-matched against a signal jack
      seeking: "in",
      fixedRef: n.id,
      fixedNode: n.id,
      fixedAt: jackPoint(n, "out", 0),
    });
  }, []);

  const landAutomation = useCallback((n: GraphNode, w: WebWidget) => {
    const cur = patchRef.current;
    if (!cur?.curve || !n.module || !w.bind) return;
    cb.current.onAutomate?.(n.module, w.bind, cur.curve.curve);
    setPatchNow(null);
  }, []);

  const startEvent = useCallback((n: GraphNode, event: string) => {
    suppressClick.current = false;
    setPatchNow({
      kind: "event",
      type: "event",
      seeking: "in",
      fixedRef: n.id,
      fixedNode: n.id,
      fixedAt: eventPoint(n, "out", Math.max(0, n.events?.indexOf(event) ?? 0)),
      // The module the note-on leaves — what becomes the binding's `trigger`.
      curve: { curve: "", module: n.module ?? n.label },
    });
  }, []);

  const landEvent = useCallback((n: GraphNode) => {
    const cur = patchRef.current;
    const b = n.curveOf;
    // A free card has no binding to write a trigger onto — the second guard, not the only one.
    if (cur?.kind !== "event" || !b?.module || !b.param) return;
    cb.current.onAutomate?.(b.module, b.param, b.curve, cur.curve?.module);
    setPatchNow(null);
  }, []);

  const tapJack = useCallback(
    (
      n: GraphNode,
      side: "in" | "out",
      p: Jack,
      index: number,
      phase: "down" | "up",
    ) => {
      const cur = patchRef.current;
      const here = jackRef(n, p.name);
      // A press STARTS a gesture, so it clears the flag itself: no pointerup will — docs/hosting.md.
      if (phase === "down") suppressClick.current = false;
      const act = patchAct(phase, !!cur, armedFrom.current, here);
      if (phase === "up" || act === "land") {
        // NodeInner arms only jacks of the seeking side, free and type-matched: land it.
        if (cur && act === "land") landPatch(cur, n, p);
        armedFrom.current = null;
        return;
      }
      armedFrom.current = here;
      if (p.free) {
        // A free OUT jack starts a NEW cable (a free IN jack is never armed at rest).
        setPatchNow({
          type: p.type,
          seeking: "in",
          fixedRef: jackRef(n, p.name),
          fixedNode: n.id,
          fixedAt: jackPoint(n, "out", index),
        });
        return;
      }
      // An occupied jack lifts the FIRST signal cable's end off it, where a drop has somewhere to go.
      if (!cb.current.onReplug || !cb.current.onDisconnect) return;
      const g = graphRef.current;
      // Matched by the port the cable NAMES — or the FIRST jack when it names none, docs/hosting.md.
      const portOf = (ed: GraphEdge) =>
        (side === "out" ? ed.sourcePort : ed.targetPort) ?? undefined;
      const e = g.edges.find(
        (ed) =>
          !ed.automation &&
          (side === "out" ? ed.source : ed.target) === n.id &&
          (portOf(ed) === (p.name ?? undefined) ||
            (portOf(ed) === undefined && index === 0)),
      );
      if (!e) return; // only automation plugs here — those cables are edited on the module
      const src = g.nodes.find((x) => x.id === e.source);
      const tgt = g.nodes.find((x) => x.id === e.target);
      if (!src || !tgt) return;
      const from = jackRef(src, e.sourcePort);
      const to = jackRef(tgt, e.targetPort);
      const inIndex = Math.max(
        0,
        tgt.jacks?.in.findIndex((j) => j.name === e.targetPort) ?? 0,
      );
      const outIndex = Math.max(
        0,
        src.jacks?.out.findIndex((j) => j.name === e.sourcePort) ?? 0,
      );
      setPatchNow(
        side === "out"
          ? {
              // The source end comes off: the loose end seeks a new OUT jack to leave from.
              type: p.type,
              seeking: "out",
              fixedRef: to,
              fixedNode: tgt.id,
              fixedAt: jackPoint(tgt, "in", inIndex),
              edge: { id: e.id, from, to },
            }
          : {
              // The target end comes off: the source stays plugged, as a new cable would be.
              type: p.type,
              seeking: "in",
              fixedRef: from,
              fixedNode: src.id,
              fixedAt: jackPoint(src, "out", outIndex),
              edge: { id: e.id, from, to },
            },
      );
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: setPatchNow reads refs only.
    [],
  );

  // Direct DOM on every move, no re-render: the cable's loose end is the cursor, 60 times a second.
  const movePatch = useCallback(
    (e: React.PointerEvent) => {
      const cur = patchRef.current;
      const el = patchEl.current;
      if (!cur || !el) return;
      const w = toWorld(e.clientX, e.clientY);
      el.setAttribute(
        "d",
        cur.seeking === "in" ? patchD(cur.fixedAt, w) : patchD(w, cur.fixedAt),
      );
    },
    [toWorld],
  );

  // What every node's jack gating reads — memoised, or a new object would re-render all the cards.
  const patchWant = useMemo(
    () =>
      patch
        ? {
            seeking: patch.seeking,
            type: patch.type,
            node: patch.fixedNode,
            kind: patch.kind ?? "signal",
          }
        : null,
    [patch],
  );

  // A cable dropped on the BARE canvas is DELETED; a new one simply ceases — docs/hosting.md.
  const canvasDrop = (e: React.MouseEvent): boolean => {
    const cur = patchRef.current;
    if (!cur || suppressClick.current) return false;
    const t = e.target as HTMLElement;
    if (t !== hostRef.current && !t.classList?.contains("dgx-world"))
      return false;
    if (cur.edge) cb.current.onDisconnect?.(cur.edge.from, cur.edge.to);
    setPatchNow(null);
    return true;
  };

  // --- dragging a node by its HEADER: the pin gesture (docs/hosting.md) --------------
  const nodeDrag = useRef<{
    n: GraphNode;
    el: HTMLElement;
    sx: number;
    sy: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  // Dropped, written, waiting for the reload: offsets to honour and transforms to take off later.
  const droppedNodes = useRef(
    new Map<string, { dx: number; dy: number; el: HTMLElement }>(),
  );

  const beginNodeDrag = useCallback((n: GraphNode, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // The same press must not also arm a pan — the reason every header control stops it too.
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest(
      "[data-node-id]",
    ) as HTMLElement | null;
    if (!el) return;
    // A press STARTS a gesture, so it clears the flag itself, exactly as a jack does.
    suppressClick.current = false;
    nodeDrag.current = {
      n,
      el,
      sx: e.clientX,
      sy: e.clientY,
      dx: 0,
      dy: 0,
      moved: false,
    };
    const onMove = (ev: PointerEvent) => {
      const d = nodeDrag.current;
      if (!d) return;
      const k = Math.max(cam.current.k, 0.01);
      d.dx = (ev.clientX - d.sx) / k;
      d.dy = (ev.clientY - d.sy) / k;
      if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 3) d.moved = true;
      d.el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
      // The cables follow live, through the same path a node MOTION takes, springs included.
      rebuildCables.current();
      paintRef.current();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = nodeDrag.current;
      nodeDrag.current = null;
      if (!d) return;
      if (!d.moved) {
        // A press that never travelled is a click, and the click is the node's own.
        d.el.style.transform = "";
        return;
      }
      // It travelled, so the click that follows is the drag's tail rather than a tap: swallow it.
      suppressClick.current = true;
      // Wherever it was let go, including ABOVE the first track or left of it — docs/hosting.md.
      const x = Math.round(d.n.x + d.dx);
      const y = Math.round(d.n.y + d.dy);
      droppedNodes.current.set(d.n.id, {
        dx: x - d.n.x,
        dy: y - d.n.y,
        el: d.el,
      });
      // Pre-seed the drawn map with the drop, so the layout landing the write plans NO slide.
      drawn.current.set(d.n.id, { node: d.n, x, y });
      rebuildCables.current();
      paintRef.current();
      cb.current.onMoveNode?.(jackRef(d.n), x, y);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Esc or ANY right-click puts the cable in hand BACK, in the CAPTURE phase and writing nothing.
  useEffect(() => {
    if (!patch) return;
    const back = () => {
      patchRef.current = null;
      setPatch(null);
      rebuildCables.current();
      paintRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      back();
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      back();
    };
    window.addEventListener("keydown", onKey, true);
    const host = hostRef.current;
    host?.addEventListener("contextmenu", onCtx, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      host?.removeEventListener("contextmenu", onCtx, true);
    };
  }, [patch]);
  // Right-click on EMPTY canvas — the picker, for a module that lands wired to nothing.
  const canvasMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const t = e.target as Node;
    if (
      t !== hostRef.current &&
      !(t as HTMLElement).classList?.contains("dgx-world")
    )
      return;
    // The click's WORLD point rides along: the module picked will be born exactly there.
    cb.current.onCanvasInsert?.(
      e.clientX,
      e.clientY,
      toWorld(e.clientX, e.clientY),
    );
  };

  const showWidgets = lod.widgets;
  const showLabels = lod.labels;
  // Too far for the widgets ⇒ nodes draw as a fitted name instead (see Node's far branch).
  const far = !showWidgets;

  // Where the meters read their levels — PROVIDED here rather than demanded, docs/hosting.md.
  const ownStore = useRef<EngineStore | null>(null);
  ownStore.current ??= new EngineStore();
  const meterStore = hostStore ?? ownStore.current;

  return (
    <EngineStoreProvider value={meterStore}>
      <IconsContext.Provider value={icons}>
        <div
          ref={hostRef}
          className={`dgx${panning ? " panning" : ""}`}
          onPointerDown={onPointerDown}
          // Bound only while a cable is in hand — the graph pays nothing for the gesture at rest.
          onPointerMove={patch ? movePatch : undefined}
          onClick={patch ? canvasDrop : undefined}
          onContextMenu={canvasMenu}
          style={{ cursor: hovered ? "pointer" : undefined }}
        >
          {/* The signal cables, OUTSIDE `.dgx-world`: a canvas scaled by CSS goes blurry, so the camera is applied to the 2D context. */}
          <canvas ref={cvRef} className="dgx-cablecv" />
          {/* No `transform` here: the frame loop writes the camera onto this element, so React never fights a gesture. */}
          <div className="dgx-world" ref={worldRef}>
            <svg
              className="dgx-cables"
              ref={cablesSvg}
              width={graph.width}
              height={graph.height}
            >
              <Cables
                signal={model.signal}
                auto={model.auto}
                showLabels={showLabels}
                hovered={hovered}
                setHovered={setHovered}
                onInsert={onEdgeInsert ? insert : undefined}
              />
              {/* The cable in hand, moved by movePatch off-React, in the world SVG so jackPoint's coordinates hold. */}
              {patch && (
                <path
                  ref={patchEl}
                  className="dgx-patchcable"
                  style={{ stroke: cableColorFor(patch.type) }}
                  d={patchD(patch.fixedAt, patch.fixedAt)}
                />
              )}
            </svg>
            {/* On their way out, before the live nodes so an arriving card paints over the one it replaces. */}
            {ghosts.map((g) => (
              <Node
                key={`gone:${g.node.id}`}
                n={{ ...g.node, x: g.x, y: g.y }}
                selected={null}
                showWidgets={showWidgets}
                far={far}
                ch={ch}
                trackOrder={EMPTY_ORDER}
                onTapNode={NOOP}
                onContext={NOOP}
                onOpenPlugin={NOOP}
                onBypass={NOOP}
                onDragStart={NOOP}
                onTapWidget={NOOP}
                onPickWidget={NOOP}
                onPickAsset={NOOP}
                onPickTrackInput={NOOP}
                onContextParam={NOOP}
              />
            ))}
            {graph.nodes.map((n) => (
              <Node
                key={n.id}
                n={n}
                selected={selected}
                showWidgets={showWidgets}
                far={far}
                ch={ch}
                trackOrder={trackOrder ?? EMPTY_ORDER}
                onTapNode={tapNode}
                onContext={contextNode}
                onOpenPlugin={openPlugin}
                onBypass={bypassModule}
                onToggleAssembly={onToggleAssembly}
                onNodeMenu={onNodeMenu ? openNodeMenu : undefined}
                warning={n.pluginId ? engineWarnings?.[n.pluginId] : undefined}
                onDragStart={beginDrag}
                onTapWidget={tapWidget}
                onPickWidget={pickWidget}
                onPickAsset={pickAsset}
                trackInput={
                  onPickTrackInput && n.kind === "track"
                    ? (trackInputs?.[n.label] ?? "aucune")
                    : undefined
                }
                onPickTrackInput={pickTrackInput}
                onWatchWaveform={onWatchWaveform}
                onContextParam={contextParam}
                sinkPlay={sinkPlay}
                onTapJack={onConnect ? tapJack : undefined}
                patchWant={patchWant}
                // The curve cables, all four halves gated on the one callback that commits them.
                onStartAutomation={onAutomate ? startAutomation : undefined}
                onLandAutomation={onAutomate ? landAutomation : undefined}
                onStartEvent={onAutomate ? startEvent : undefined}
                onLandEvent={onAutomate ? landEvent : undefined}
                // EVERY node can be pinned, all by jackRef's answer; the ROW refuses, and so does a
                // member of an OPEN box — its place is its FRAME's, not the graph's.
                onHeaderDrag={
                  onMoveNode && !row && !n.assembly ? beginNodeDrag : undefined
                }
              />
            ))}
          </div>
        </div>
      </IconsContext.Provider>
    </EngineStoreProvider>
  );
}
