// LcdScreenWidget.tsx — an lcdscreen widget: a <canvas> behind LCD glass, painted by the function
// the panel's `widgets.js` keeps under this widget's id. The script draws in the widget sandbox,
// never in the page, and sends back a bitmap; this side only sends it the module's live params
// and both audio taps when one of them moved (the loop rules are the waveform's,
// docs/waveformWidget.md). An INTERACTIVE screen also forwards the pointer and applies the params
// the script set through the host's LcdSetContext. The contract and the sandbox: docs/lcdScreen.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import { WOBBLE_FPS } from "@studio/ui-chains/cableCanvas";
import type { GraphNode } from "@studio/ui-chains/graph";
import {
  LCD_COLORS,
  type LcdPointerEvent,
  type LcdSounds,
  TapHistory,
} from "@studio/ui-chains/lcdScreen";
import { type DrawData, widgetSandbox } from "@studio/ui-chains/widgetSandbox";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { LcdZoomContext, lcdBackingScale } from "./lcdZoom";
import { useSandboxGeneration, useScriptInfo } from "./widgetScript";

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

// Show a bitmap the sandbox drew: handed over without a copy where the browser can, else drawn.
function present(canvas: HTMLCanvasElement, bitmap: ImageBitmap | null): void {
  const w = bitmap?.width ?? 0;
  const h = bitmap?.height ?? 0;
  if (bitmap && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w;
    canvas.height = h;
  }
  const br = canvas.getContext("bitmaprenderer");
  if (br) {
    br.transferFromImageBitmap(bitmap);
    return;
  }
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  if (bitmap) ctx?.drawImage(bitmap, 0, 0);
  bitmap?.close();
}

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
  const sb = widgetSandbox();
  const gen = useSandboxGeneration(sb);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pluginId = n.pluginId ?? null;
  const source = n.ui?.script;
  const info = useScriptInfo(source);
  const lcdSet = useContext(LcdSetContext);
  const sounds = useContext(LcdSoundsContext);
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const zoom = useContext(LcdZoomContext);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // A draw that threw is not called again until its script changes: a throw per frame is a frozen tab.
  const [crash, setCrash] = useState<{ source?: string; message: string }>();
  const crashed = crash && crash.source === source ? crash.message : undefined;
  const message = !source
    ? "no widgets.js"
    : !info
      ? undefined
      : info.error
        ? `widgets.js: ${info.error}`
        : !info.draws.includes(id)
          ? `widgets.js has no "${id}"`
          : crashed
            ? `${id}: ${crashed}`
            : undefined;
  const drawable = !!info && !message;

  const drawableRef = useRef(drawable);
  drawableRef.current = drawable;
  const interactive = drawable && !!lcdSet && !!info?.pointers.includes(id);
  const setRef = useRef(lcdSet);
  setRef.current = lcdSet;
  const nodeRef = useRef(n);
  nodeRef.current = n;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const idRef = useRef(id);
  idRef.current = id;
  // The sandbox's handle on this canvas, set while it is attached.
  const screenRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const wakeRef = useRef<() => void>(NOOP);
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
  // A render is a param, an override or the script's answer moving, and each is a repaint.
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

  // The sounds the script asked for, and the copy of each the sandbox already holds.
  const askedRef = useRef(new Set<string>());
  const sentRef = useRef(new Map<string, Float32Array | null>());
  const frameData = (W: number, H: number, scale: number): DrawData => {
    const changed: Record<string, Float32Array | null> = {};
    let any = false;
    for (const slot of askedRef.current) {
      const ref = nodeRef.current.assets?.[slot];
      const data = ref ? (soundsRef.current?.get(ref) ?? null) : null;
      if (sentRef.current.has(slot) && sentRef.current.get(slot) === data)
        continue;
      sentRef.current.set(slot, data);
      changed[slot] = data;
      any = true;
    }
    return {
      width: W,
      height: H,
      scale,
      params: paramsRef.current,
      input: tapsRef.current.input.points,
      output: tapsRef.current.output.points,
      color: LCD_COLORS,
      now: performance.now(),
      ...(any ? { sounds: changed } : {}),
    };
  };
  const frameRef = useRef(frameData);
  frameRef.current = frameData;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `gen` re-opens the screen in a rebuilt sandbox.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const screen = sb.attach();
    if (screen === null) return;
    screenRef.current = screen;
    sentRef.current = new Map();
    let W = 0;
    let H = 0;
    let raf = 0;
    let last = 0;
    let inflight = false;
    let live = true;
    const minDt = 1000 / WOBBLE_FPS;

    const paint = (): void => {
      // Sized for the camera too, since the card sits under its CSS scale — docs/lcdScreen.md.
      const scale = lcdBackingScale(
        window.devicePixelRatio || 1,
        zoomRef.current?.get() ?? 1,
        W,
        H,
      );
      const src = sourceRef.current;
      // Nothing to draw, or a draw that threw: the glass is cleared here, with no round trip.
      if (!drawableRef.current || !src) {
        present(canvas, null);
        return;
      }
      inflight = true;
      sb.draw(screen, src, idRef.current, frameRef.current(W, H, scale)).then(
        (r) => {
          inflight = false;
          if (!live) {
            r.bitmap?.close();
            return;
          }
          if (r.bitmap) present(canvas, r.bitmap);
          if (r.error) setCrash({ source: src, message: r.error });
          let fresh = false;
          for (const slot of r.asked ?? [])
            if (!askedRef.current.has(slot)) {
              askedRef.current.add(slot);
              fresh = true;
            }
          if (fresh) dirtyRef.current = true;
          if (dirtyRef.current) wake();
        },
      );
    };

    // Started by data, stopped by stillness, one frame in flight: a silent module schedules nothing.
    const tick = (now: number): void => {
      raf = 0;
      if (!dirtyRef.current || inflight || W <= 0 || H <= 0) return;
      if (now - last < minDt) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = now;
      dirtyRef.current = false;
      paint();
    };
    const wake = (): void => {
      if (!raf && live) raf = requestAnimationFrame(tick);
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
      live = false;
      ro.disconnect();
      unzoom?.();
      if (raf) cancelAnimationFrame(raf);
      wakeRef.current = NOOP;
      screenRef.current = null;
      sb.detach(screen);
    };
  }, [sb, gen]);

  useEffect(() => {
    // The pointer, native so a press the script takes never pans the graph — docs/lcdScreen.md.
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;
    let gesture: Record<string, number> | null = null;
    let pending: Record<string, number> = {};
    let raf = 0;
    let live = true;
    const flushLive = (): void => {
      raf = 0;
      const out = pending;
      pending = {};
      if (Object.keys(out).length)
        setRef.current?.(nodeRef.current, out, false);
    };
    // Each answer applies its sets in the order the events went, since the sandbox answers in order.
    const run = (
      e: PointerEvent,
      type: LcdPointerEvent["type"],
      into: Record<string, number>,
    ): Promise<void> => {
      const screen = screenRef.current;
      const src = sourceRef.current;
      if (screen === null || !src) return Promise.resolve();
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
      const frame = frameRef.current(
        canvas.clientWidth,
        canvas.clientHeight,
        1,
      );
      return sb.pointer(screen, src, idRef.current, frame, ev).then((r) => {
        if (!live) return;
        if (r.error) {
          setCrash({ source: src, message: r.error });
          return;
        }
        let moved = false;
        for (const [name, value] of Object.entries(r.sets)) {
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          into[name] = value;
          pending[name] = value;
          heldRef.current = { ...heldRef.current, [name]: value };
          moved = true;
        }
        if (moved) {
          mergeRef.current();
          if (!raf) raf = requestAnimationFrame(flushLive);
        }
        dirtyRef.current = true;
        wakeRef.current();
      });
    };
    const commit = (set: Record<string, number>): void => {
      if (!live) return;
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
      run(e, "up", set).then(() => commit(set));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      live = false;
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sb, interactive]);

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
