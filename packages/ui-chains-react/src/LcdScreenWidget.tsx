// LcdScreenWidget.tsx — an lcdscreen widget: a <canvas> behind LCD glass, painted by the function
// the panel's `widgets.js` keeps under this widget's id. It feeds that function the module's
// live params and both of its audio taps, and repaints only when one of them moved — the loop
// rules are the waveform's (docs/waveformWidget.md). The contract: docs/lcdScreen.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import { WOBBLE_FPS } from "@studio/ui-chains/cableCanvas";
import type { GraphNode } from "@studio/ui-chains/graph";
import {
  compileWidgetsScript,
  LCD_COLORS,
  type LcdDraw,
  type LcdFrame,
  TapHistory,
} from "@studio/ui-chains/lcdScreen";
import { useEffect, useRef, useState } from "react";

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
    let appliedDpr = 0;
    let raf = 0;
    let last = 0;
    const minDt = 1000 / WOBBLE_FPS;

    const paint = (now: number): void => {
      const dpr = window.devicePixelRatio || 1;
      if (
        appliedDpr !== dpr ||
        canvas.width !== W * dpr ||
        canvas.height !== H * dpr
      ) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        appliedDpr = dpr;
      }
      // Reset every frame: the script may leave any transform, clip or style behind.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    wake();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      wakeRef.current = NOOP;
    };
  }, []);

  return (
    <div className="dgx-w dgx-lcd" style={style}>
      <canvas ref={canvasRef} />
      {message && <span className="dgx-lcd-msg">{message}</span>}
    </div>
  );
}
