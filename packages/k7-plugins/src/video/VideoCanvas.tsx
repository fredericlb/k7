// VideoCanvas.tsx — the React host for the eyes realtime renderer. The imperative-WebGL
// host pattern, deliberately: the `alive` unmount guard, the refs that keep the driver
// reading fresh callbacks without tearing down its GL context, and a ResizeObserver on the
// HOST (not the window) are each a bug already paid for once. A scene change is a setScene on
// the live driver, never a rebuild. eyes knows nothing about the engine — this component owns
// the EngineClock and feeds it the reported playhead.

import { useEngineStore } from "@studio/engine-browser/store";
import { localLens } from "@studio/ui-eyes/camera";
import { EngineClock } from "@studio/ui-eyes/clock";
import { type LaneDebug, RealtimeDriver } from "@studio/ui-eyes/realtime";
import type { VideoScene } from "@studio/ui-eyes/scene";
import { useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import { canAskForLens, remoteLens } from "./camera/remoteLens";
import { levelsForPasses, smoothLevels } from "./shaderAudio";

/** Whose camera a live lane draws: this browser's, or the machine's over a peer connection when
 *  this device may not open one — which is every device reaching the app over the LAN.
 *  Falling back to the local opener with neither leaves it to say why. See ../camera/relay.ts. */
const lensOpener = () =>
  typeof navigator.mediaDevices?.getUserMedia === "function" || !canAskForLens()
    ? localLens
    : remoteLens;

// Letterbox the viewport's aspect in the host: the backing store keeps its pixel size, only CSS size changes.
function letterbox(
  driver: RealtimeDriver,
  host: HTMLElement,
  scene: VideoScene,
): { w: number; h: number } | null {
  const [vw, vh] = scene.viewport;
  if (!vw || !vh) return null;
  const hw = host.clientWidth;
  const hh = host.clientHeight;
  const s = Math.min(hw / vw, hh / vh);
  const box = { w: Math.round(vw * s), h: Math.round(vh * s) };
  driver.resize(box.w, box.h);
  return box;
}

export function VideoCanvas({
  scene,
  audioSources,
  trackIds,
  onDebug,
  onFit,
  children,
}: {
  scene: VideoScene;
  /** Drawn OVER the canvas, inside the same centring host — see ViewportOverlay. */
  children?: React.ReactNode;
  /** Which lane drives each shader pass's `uAudio`, by pass id (shaderAudio.ts) — empty for every song that shades nothing. */
  audioSources?: Readonly<Record<string, string>>;
  /** The compiled track order — how the engine's nameless `levels` array is indexed. */
  trackIds?: readonly string[];
  /** Per-lane drift, a few times a second. Omitted unless somebody is profiling — see profiling.ts. */
  onDebug?: (d: LaneDebug[]) => void;
  /** The canvas's CSS size after letterboxing — what an overlay must match to sit exactly on the frame. */
  onFit?: (box: { w: number; h: number } | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const driverRef = useRef<RealtimeDriver | null>(null);
  const clockRef = useRef<EngineClock | null>(null);
  const onDebugRef = useRef(onDebug);
  onDebugRef.current = onDebug;
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  // In a ref for the same reason the debug callback is: the subscription must read a fresh map without losing the GL context.
  const sourcesRef = useRef(audioSources);
  sourcesRef.current = audioSources;
  const trackIdsRef = useRef(trackIds);
  trackIdsRef.current = trackIds;
  // The driver is built off the scene of its first render; every later one reaches it by setScene.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  // The smoothed levels, held across reports — a ref, since nothing React draws depends on them.
  const levelsRef = useRef<Record<string, number>>({});
  // The store itself, not a slice of it: the playhead is fed to a clock, and feeding a clock is not drawing.
  const store = useEngineStore();
  // Why there is no picture, when the GL side refused to start.
  const [failed, setFailed] = useState<string | null>(null);
  // Bumped when the browser gives a lost GL context back: the driver is built again on a fresh one.
  const [rebuild, setRebuild] = useState(0);

  // The driver lives as long as its GL context: built once, and again only after a lost context comes back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rebuild` is a trigger, not a value the body reads.
  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;
    const clock = new EngineClock();
    clockRef.current = clock;
    let driver: RealtimeDriver;
    try {
      driver = RealtimeDriver.create(
        host,
        sceneRef.current,
        clock,
        lensOpener(),
      );
    } catch (e) {
      // No WebGL2 (a blocklisted GPU, an old tablet, contexts refused): said here, not a blank app.
      setFailed((e as Error).message);
      return;
    }
    setFailed(null);
    if (!alive) {
      driver.destroy();
      return;
    }
    driverRef.current = driver;
    // A GPU reset or a sleep LOSES the context: kept restorable, and rebuilt when the browser restores it — not black for good.
    const canvas = host.querySelector("canvas");
    const onLost = (e: Event) => e.preventDefault();
    const onRestored = () => setRebuild((n) => n + 1);
    canvas?.addEventListener("webglcontextlost", onLost);
    canvas?.addEventListener("webglcontextrestored", onRestored);
    onFitRef.current?.(letterbox(driver, host, sceneRef.current));
    // Where the transport is RIGHT NOW: a fresh clock knows nothing, and with the transport stopped the next frame can be 250 ms away.
    const now = store.getSnapshot();
    clock.feed(now.playing, now.playhead);

    // Poll the per-lane drift for the debug readout (not per-frame — the pane only needs it a few times a second).
    const dbg = onDebugRef.current
      ? window.setInterval(() => onDebugRef.current?.(driver.debugState()), 200)
      : 0;

    return () => {
      alive = false;
      if (dbg) clearInterval(dbg);
      canvas?.removeEventListener("webglcontextlost", onLost);
      canvas?.removeEventListener("webglcontextrestored", onRestored);
      driver.destroy();
      driverRef.current = null;
      clockRef.current = null;
    };
  }, [store, rebuild]);

  // A document edit (useVideoDoc keeps an unchanged picture the same object) is handed to the SAME driver: no new context, no new decoders.
  useEffect(() => {
    const driver = driverRef.current;
    const host = hostRef.current;
    if (!driver || !host || driver.current === scene) return;
    try {
      driver.setScene(scene);
    } catch (e) {
      // A scene the live context could not take: start again on a fresh driver rather than leave a half-built one.
      console.error("[viewport] setScene failed, rebuilding", e);
      setRebuild((n) => n + 1);
      return;
    }
    onFitRef.current?.(letterbox(driver, host, scene));
  }, [scene]);

  /** Feed the clock every engine state frame, off a RAW subscription that renders nothing — here the right leaf is no component at all. */
  useEffect(() => {
    const feed = (): void => {
      const s = store.getSnapshot();
      clockRef.current?.feed(s.playing, s.playhead);
      // …and the shaders' `uAudio`, off the SAME frame: `levels` is indexed against the track list, so the lookup needs both.
      const sources = sourcesRef.current;
      if (!sources || !Object.keys(sources).length) return;
      levelsRef.current = smoothLevels(
        levelsRef.current,
        levelsForPasses(sources, trackIdsRef.current ?? [], s.levels ?? []),
      );
      driverRef.current?.setAudio(levelsRef.current);
    };
    return store.subscribe(feed);
  }, [store]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const d = driverRef.current;
      if (d) onFitRef.current?.(letterbox(d, host, sceneRef.current));
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // The driver appends its own canvas and parked <video>s; `children` is the overlay, sitting on it.
  return (
    <div
      ref={hostRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
    >
      {failed ? (
        <div className="max-w-sm p-4 text-center text-muted-foreground text-sm">
          {m["video.cannotDraw"]({ why: failed })}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
