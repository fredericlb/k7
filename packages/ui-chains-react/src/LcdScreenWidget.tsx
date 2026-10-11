// LcdScreenWidget.tsx — an lcdscreen widget: a <canvas> behind LCD glass, painted by the function
// the panel's `widgets.js` keeps under this widget's id. It feeds that function the module's
// live params and both of its audio taps, and repaints only when one of them moved — the loop
// rules are the waveform's (docs/waveformWidget.md). An INTERACTIVE screen also gets the pointer and
// sets params through the host's LcdSetContext. The contract: docs/lcdScreen.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import { WOBBLE_FPS } from "@studio/ui-chains/cableCanvas";
import type { GraphNode } from "@studio/ui-chains/graph";
import {
  compileWidgetsScript,
  LCD_COLORS,
  type LcdDraw,
  type LcdFrame,
  type LcdPointer,
  type LcdPointerEvent,
  type LcdSounds,
  TapHistory,
} from "@studio/ui-chains/lcdScreen";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { LcdZoomContext, lcdBackingScale } from "./lcdZoom";

/** How a screen changes its module: live while `commit` is false, written into the file when it is true. */
export type LcdSet = (
  n: GraphNode,
  changes: Readonly<Record<string, number>>,
  commit: boolean,
) => void;

/** The host's setter; absent, every screen only draws. */
export const LcdSetContext = createContext<LcdSet | null>(null);
/** The host's decoder of a module's sound files, for `lcd.sound(slot)` — none, and every slot reads null. */
export const LcdSoundsContext = createContext<LcdSounds | null>(null);

const NOOP = (): void => {};
type Side = "input" | "output";
const SIDES: readonly Side[] = ["input", "output"];

export function LcdScreenWidget({
  n,
  id,
  style,
  params,
  override,
  onWatch,
}: {
  n: GraphNode;
  /** The widget's key in the panel — what `widgets.js` names its draw function by. */
  id: string;
  style: React.CSSProperties;
  params: PluginParamsStore;
  /** Values a drag is holding right now, keyed `p:<pluginId>:<param>` like every widget's. */
  override: Record<string, number>;
  onWatch?: (pluginId: string, side: Side, on: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pluginId = n.pluginId ?? null;
  const script = compileWidgetsScript(n.ui?.script);
  const draw = script.draws[id];
  const pointer = script.pointers[id];
  const lcdSet = useContext(LcdSetContext);
  const sounds = useContext(LcdSoundsContext);
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const zoom = useContext(LcdZoomContext);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // A draw that threw is not called again until its script changes: a throw per frame is a frozen tab.
  const [crash, setCrash] = useState<{ source?: string; message: string }>();
  const crashed =
    crash && crash.source === n.ui?.script ? crash.message : undefined;
  const message = script.error
    ? `widgets.js: ${script.error}`
    : !n.ui?.script
      ? "no widgets.js"
      : !draw
        ? `widgets.js has no "${id}"`
        : crashed
          ? `${id}: ${crashed}`
          : undefined;

  const drawRef = useRef<LcdDraw | undefined>(draw);
  drawRef.current = message ? undefined : draw;
  const pointerRef = useRef<LcdPointer | undefined>(pointer);
  pointerRef.current = message || !lcdSet ? undefined : pointer;
  const setRef = useRef(lcdSet);
  setRef.current = lcdSet;
  const nodeRef = useRef(n);
  nodeRef.current = n;
  const interactive = !!pointerRef.current;
  // The file a slot names, as the node's assets say, through the host's decoder.
  const soundOf = useCallback((slot: string): Float32Array | null => {
    const ref = nodeRef.current.assets?.[slot];
    return ref ? (soundsRef.current?.get(ref) ?? null) : null;
  }, []);
  const sourceRef = useRef(n.ui?.script);
  sourceRef.current = n.ui?.script;
  const dirtyRef = useRef(true);
  const wakeRef = useRef<() => void>(NOOP);
  const stateRef = useRef<Record<string, unknown>>({});
  const tapsRef = useRef({ input: new TapHistory(), output: new TapHistory() });

  // Authored, then what the engine reports, then what a drag holds — the order every widget reads in.
  const authoredRef = useRef(n.params);
  authoredRef.current = n.params;
  const overrideRef = useRef(override);
  overrideRef.current = override;
  const paramsRef = useRef<Record<string, number>>({});
  const heldRef = useRef<Record<string, number>>({});
  const mergeParams = (): void => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(authoredRef.current ?? {}))
      if (typeof v === "number") out[k] = v;
    if (pluginId) {
      Object.assign(out, params.getSnapshot()[pluginId] ?? {});
      const prefix = `p:${pluginId}:`;
      for (const [k, v] of Object.entries(overrideRef.current))
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
    // What the gesture in hand has set outranks all three, until it is written.
    Object.assign(out, heldRef.current);
    paramsRef.current = out;
  };
  mergeParams();
  const mergeRef = useRef(mergeParams);
  mergeRef.current = mergeParams;
  // A render is a param or an override moving, and either is a repaint.
  useEffect(() => {
    dirtyRef.current = true;
    wakeRef.current();
  });

  // A file landing is a repaint too: the first draws found it still loading.
  useEffect(
    () =>
      sounds?.subscribe(() => {
        dirtyRef.current = true;
        wakeRef.current();
      }),
    [sounds],
  );
  useEffect(() => {
    if (!pluginId) return;
    return params.subscribeTo(pluginId, () => {
      mergeRef.current();
      dirtyRef.current = true;
      wakeRef.current();
    });
  }, [params, pluginId]);

  // Both taps, into histories the screen keeps: a frame carries ~50 ms, and a picture wants seconds.
  const store = useEngineStoreOrNull();
  useEffect(() => {
    if (!store || !pluginId) return;
    const last: Record<Side, unknown> = { input: null, output: null };
    const read = (): void => {
      const wf = store.getSnapshot().waveform;
      let moved = false;
      for (const side of SIDES) {
        const env = wf[`${pluginId}:${side}`];
        if (!env || env === last[side]) continue;
        last[side] = env;
        if (!env.length) continue;
        tapsRef.current[side].push(env);
        moved = true;
      }
      if (!moved) return;
      dirtyRef.current = true;
      wakeRef.current();
    };
    read();
    return store.subscribe(read);
  }, [store, pluginId]);

  // The taps cost the engine two plugins, so they live exactly as long as the screen.
  useEffect(() => {
    if (!pluginId || !onWatch) return;
    for (const side of SIDES) onWatch(pluginId, side, true);
    return () => {
      for (const side of SIDES) onWatch(pluginId, side, false);
    };
  }, [pluginId, onWatch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let W = 0;
    let H = 0;
    let appliedScale = 0;
    let raf = 0;
    let last = 0;
    const minDt = 1000 / WOBBLE_FPS;

    const paint = (now: number): void => {
      // Sized for the camera too, since the card sits under its CSS scale — docs/lcdScreen.md.
      const scale = lcdBackingScale(
        window.devicePixelRatio || 1,
        zoomRef.current?.get() ?? 1,
        W,
        H,
      );
      const bw = Math.round(W * scale);
      const bh = Math.round(H * scale);
      if (
        appliedScale !== scale ||
        canvas.width !== bw ||
        canvas.height !== bh
      ) {
        canvas.width = bw;
        canvas.height = bh;
        appliedScale = scale;
      }
      // Reset every frame: the script may leave any transform, clip or style behind.
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const f = drawRef.current;
      if (!f) return;
      const frame: LcdFrame = {
        ctx,
        width: W,
        height: H,
        params: paramsRef.current,
        input: tapsRef.current.input.points,
        output: tapsRef.current.output.points,
        state: stateRef.current,
        color: LCD_COLORS,
        sound: soundOf,
        now,
      };
      ctx.save();
      try {
        f(frame);
      } catch (e) {
        drawRef.current = undefined;
        setCrash({ source: sourceRef.current, message: (e as Error).message });
      } finally {
        ctx.restore();
      }
    };

    // Started by data, stopped by stillness: a silent module schedules no frames at all.
    const tick = (now: number): void => {
      raf = 0;
      if (!dirtyRef.current || W <= 0 || H <= 0) return;
      if (now - last < minDt) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = now;
      dirtyRef.current = false;
      paint(now);
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
    // A settled zoom is a new resolution: repaint at it.
    const unzoom = zoomRef.current?.subscribe(() => {
      dirtyRef.current = true;
      wake();
    });
    wake();
    return () => {
      ro.disconnect();
      unzoom?.();
      if (raf) cancelAnimationFrame(raf);
      wakeRef.current = NOOP;
    };
  }, [soundOf]);

  // The pointer, native so a press the script takes never pans the graph — docs/lcdScreen.md.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;
    let gesture: Record<string, number> | null = null;
    let pending: Record<string, number> = {};
    let raf = 0;
    const flushLive = (): void => {
      raf = 0;
      const out = pending;
      pending = {};
      if (Object.keys(out).length)
        setRef.current?.(nodeRef.current, out, false);
    };
    const run = (
      e: PointerEvent,
      type: LcdPointerEvent["type"],
      into: Record<string, number>,
    ): boolean => {
      const f = pointerRef.current;
      if (!f) return false;
      const box = canvas.getBoundingClientRect();
      // The card is drawn under the camera's scale, and the script works in the canvas's own pixels.
      const sx = box.width > 0 ? canvas.clientWidth / box.width : 1;
      const sy = box.height > 0 ? canvas.clientHeight / box.height : 1;
      const ev: LcdPointerEvent = {
        type,
        x: (e.clientX - box.left) * sx,
        y: (e.clientY - box.top) * sy,
        shift: e.shiftKey,
        alt: e.altKey,
      };
      let took: boolean | undefined;
      try {
        took = f(
          {
            width: canvas.clientWidth,
            height: canvas.clientHeight,
            params: paramsRef.current,
            input: tapsRef.current.input.points,
            output: tapsRef.current.output.points,
            state: stateRef.current,
            color: LCD_COLORS,
            sound: soundOf,
            now: performance.now(),
            set(name, value) {
              if (typeof value !== "number" || !Number.isFinite(value)) return;
              into[name] = value;
              pending[name] = value;
              heldRef.current = { ...heldRef.current, [name]: value };
              mergeRef.current();
              if (!raf) raf = requestAnimationFrame(flushLive);
            },
          },
          ev,
        );
      } catch (err) {
        pointerRef.current = undefined;
        setCrash({
          source: sourceRef.current,
          message: (err as Error).message,
        });
        return false;
      }
      dirtyRef.current = true;
      wakeRef.current();
      return !!took;
    };
    const commit = (set: Record<string, number>): void => {
      if (raf) {
        cancelAnimationFrame(raf);
        flushLive();
      }
      heldRef.current = {};
      mergeRef.current();
      if (Object.keys(set).length) setRef.current?.(nodeRef.current, set, true);
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      // Never a pan or a selection: the press is the screen's.
      e.stopPropagation();
      gesture = {};
      canvas.setPointerCapture(e.pointerId);
      run(e, "down", gesture);
    };
    const move = (e: PointerEvent): void => {
      if (gesture) run(e, "move", gesture);
    };
    const up = (e: PointerEvent): void => {
      if (!gesture) return;
      const set = gesture;
      gesture = null;
      run(e, "up", set);
      commit(set);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [interactive, soundOf]);

  return (
    <div
      className={interactive ? "dgx-w dgx-lcd live" : "dgx-w dgx-lcd"}
      style={style}
    >
      <canvas ref={canvasRef} />
      {message && <span className="dgx-lcd-msg">{message}</span>}
    </div>
  );
}
