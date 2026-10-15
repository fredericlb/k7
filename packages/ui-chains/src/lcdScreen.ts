// lcdScreen.ts — the contract a panel's `widgets.js` is written against (its lcdscreen draws, its
// pointer handlers, its `visible` rule) and the rolling history of the audio taps the draws read.
// No script runs here: they run in the widget sandbox (widgetSandbox.ts, widgetRuntime.ts), an
// opaque origin, so these types describe what the sandbox hands a script, not page objects.
// Rationale and the draw contract: packages/ui-chains-react/docs/lcdScreen.md.

/** One tap point as the engine sends it — structural, so this package needs no engine dependency. */
type Envelope = { min: number; max: number };

/** What one draw call gets — the whole contract a `widgets.js` is written against. */
export interface LcdFrame {
  /** An OFFSCREEN canvas in the sandbox, scaled to CSS pixels and cleared: draw in `width` × `height`. */
  ctx: OffscreenCanvasRenderingContext2D;
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
  /** The FILE a slot of the module names (a Faust table), decoded mono; null until loaded, or with no host to load it. */
  sound: (slot: string) => Float32Array | null;
}

/** Where a host decodes a module's sound files for its screens: `get` answers from cache and starts a load; `subscribe` hears one land. */
export interface LcdSounds {
  get(ref: string): Float32Array | null;
  subscribe(onLoaded: () => void): () => void;
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

/** How many tap points a screen keeps — ~6 s at 44.1 kHz with the engine's 256-sample bucket. */
export const LCD_HISTORY = 1024;

/** The glass and ink every screen shares, named so a script and the CSS agree. */
export const LCD_COLORS: LcdFrame["color"] = {
  ink: "#b8f0a0",
  dim: "rgba(184,240,160,0.28)",
  glow: "#e8ffd8",
  bg: "#0f1a10",
};

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
