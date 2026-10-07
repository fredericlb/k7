// lcdScreen.ts — what a panel's `widgets.js` runs: its lcdscreen draws and its `visible` rule,
// compiled once per source text, and the rolling history of the audio taps the draws read. The script
// is the module author's own code running in the page, with the trust a jsdsp module already
// has in the engine. Framework-agnostic; the React half is ui-chains-react's LcdScreenWidget.
// Rationale and the draw contract: packages/ui-chains-react/docs/lcdScreen.md.

/** One tap point as the engine sends it — structural, so this package needs no engine dependency. */
type Envelope = { min: number; max: number };

/** What one draw call gets — the whole contract a `widgets.js` is written against. */
export interface LcdFrame {
  /** Already scaled to CSS pixels and cleared: draw in `width` × `height`. */
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** The module's params by name, live where the engine reports them, else as authored. */
  params: Readonly<Record<string, number>>;
  /** Peak amplitude per engine bucket (~6 ms), oldest first, entering the module… */
  input: readonly number[];
  /** …and leaving it. Both end NOW, so their last points line up. */
  output: readonly number[];
  /** This screen's own scratch object, kept between draws and dropped with the widget. */
  state: Record<string, unknown>;
  /** The palette the screen's glass is drawn in, so a script matches it without hardcoding. */
  color: { ink: string; dim: string; glow: string; bg: string };
  /** `performance.now()` at this draw. */
  now: number;
}

/** One screen's draw function: `widgets.js` maps a widget id to one of these. */
export type LcdDraw = (lcd: LcdFrame) => void;

/** A pointer on an INTERACTIVE screen, in the same CSS pixels the draw uses. */
export interface LcdPointerEvent {
  /** `down`, `move` and `up` bracket one gesture — a screen takes no wheel, which is the graph's zoom. */
  type: "down" | "move" | "up";
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
}

/** What a pointer handler gets: the frame it would draw, plus the one way to change the module. */
export interface LcdPointerFrame extends Omit<LcdFrame, "ctx"> {
  /** Set a param by name: heard at once, written into the module's file when the gesture ends. */
  set(name: string, value: number): void;
}

/** A pointer handler: returns true when it took the event. */
export type LcdPointer = (
  lcd: LcdPointerFrame,
  ev: LcdPointerEvent,
) => boolean | undefined;

/** What the panel's `visible` gets: the module as it stands, with nothing to draw on. */
export interface PanelFrame {
  /** The module's params by name, as the card reads them. */
  params: Readonly<Record<string, number | string>>;
  /** The files it loads by param name, as authored — `model`, `ir`… */
  assets: Readonly<Record<string, string>>;
  /** The amp model it loads, when it loads one the file service could read — `knobs` is how many it reacts to. */
  ampModel?: { kind: "nam" | "aida-x" | "proteus"; knobs: number };
}

/** `widgets.js`'s reserved `visible` key: widget id → false hides it; an id it leaves out stays shown. */
export type PanelVisible = (
  panel: PanelFrame,
) => Readonly<Record<string, boolean>> | undefined;

/** The reserved key — a screen cannot be named this, and the builder says so. */
export const VISIBLE_KEY = "visible";

/** A compiled script: the draw functions it returned, the pointer handlers, or why there are none. */
export interface LcdScript {
  draws: Readonly<Record<string, LcdDraw>>;
  pointers: Readonly<Record<string, LcdPointer>>;
  visible?: PanelVisible;
  error?: string;
}

/** The widget ids a script hides for this module; a `visible` that throws hides nothing, so a bug never empties a card. */
export function hiddenWidgets(
  script: LcdScript,
  panel: PanelFrame,
): ReadonlySet<string> {
  if (!script.visible) return EMPTY;
  let shown: Readonly<Record<string, boolean>> | undefined;
  try {
    shown = script.visible(panel);
  } catch {
    return EMPTY;
  }
  if (!shown || typeof shown !== "object") return EMPTY;
  return new Set(Object.keys(shown).filter((id) => shown[id] === false));
}
const EMPTY: ReadonlySet<string> = new Set();

/** How many tap points a screen keeps — ~6 s at 44.1 kHz with the engine's 256-sample bucket. */
export const LCD_HISTORY = 1024;

/** The glass and ink every screen shares, named so a script and the CSS agree. */
export const LCD_COLORS: LcdFrame["color"] = {
  ink: "#b8f0a0",
  dim: "rgba(184,240,160,0.28)",
  glow: "#e8ffd8",
  bg: "#0f1a10",
};

// `export default {…}` is read as `return {…}`, so the file is a module to an editor and a body to this.
const EXPORT_DEFAULT = /^\s*export\s+default\s+/m;

const NONE: LcdScript = { draws: {}, pointers: {} };
const cache = new Map<string, LcdScript>();
const CACHE_MAX = 32;

/** Compile a `widgets.js` once per TEXT, so twenty screens of one module run one compile. */
export function compileWidgetsScript(source: string | undefined): LcdScript {
  if (!source?.trim()) return NONE;
  const hit = cache.get(source);
  if (hit) return hit;
  const compiled = compile(source);
  if (cache.size >= CACHE_MAX)
    cache.delete(cache.keys().next().value as string);
  cache.set(source, compiled);
  return compiled;
}

function compile(source: string): LcdScript {
  const body = source.replace(EXPORT_DEFAULT, "return ");
  let out: unknown;
  try {
    // The one eval in the app, and on purpose: the draw is the module author's code — docs/lcdScreen.md.
    out = new Function(`"use strict";\n${body}`)();
  } catch (e) {
    return {
      draws: {},
      pointers: {},
      error: (e as Error).message || String(e),
    };
  }
  if (!out || typeof out !== "object")
    return {
      draws: {},
      pointers: {},
      error: "widgets.js must return an object: { <widget id>: (lcd) => … }",
    };
  const draws: Record<string, LcdDraw> = {};
  const pointers: Record<string, LcdPointer> = {};
  let visible: PanelVisible | undefined;
  for (const [id, f] of Object.entries(out as Record<string, unknown>)) {
    if (id === VISIBLE_KEY) {
      if (typeof f === "function") visible = f as PanelVisible;
    } else if (typeof f === "function") draws[id] = f as LcdDraw;
    // An interactive screen is `{ draw, pointer }` — docs/lcdScreen.md.
    else if (f && typeof f === "object") {
      const { draw, pointer } = f as { draw?: unknown; pointer?: unknown };
      if (typeof draw === "function") draws[id] = draw as LcdDraw;
      if (typeof pointer === "function") pointers[id] = pointer as LcdPointer;
    }
  }
  return visible ? { draws, pointers, visible } : { draws, pointers };
}

/** An envelope point as the one number a meter wants: how far from zero it swung. */
export const peakOf = (e: Envelope): number =>
  Math.max(Math.abs(e.min), Math.abs(e.max));

/** A capped history of peaks, appended to per tap frame; oldest points fall off the front. */
export class TapHistory {
  readonly points: number[] = [];
  constructor(private readonly cap = LCD_HISTORY) {}

  push(frame: readonly Envelope[]): void {
    for (const e of frame) this.points.push(peakOf(e));
    const over = this.points.length - this.cap;
    if (over > 0) this.points.splice(0, over);
  }
}
