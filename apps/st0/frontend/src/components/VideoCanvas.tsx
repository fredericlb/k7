// VideoCanvas.tsx — the React host for the eyes realtime renderer. The imperative-WebGL
// host pattern, deliberately: the `alive` unmount guard, the refs that keep the driver
// reading fresh callbacks without tearing down its GL context, and a ResizeObserver on the
// HOST (not the window) are each a bug already paid for once. eyes knows nothing about the
// engine — this component owns the EngineClock and feeds it the reported playhead.

import { useEngineStore } from "@studio/engine-browser/store";
import { EngineClock } from "@studio/ui-eyes/clock";
import { type LaneDebug, RealtimeDriver } from "@studio/ui-eyes/realtime";
import type { VideoScene } from "@studio/ui-eyes/scene";
import { useEffect, useRef } from "react";
import { levelsForPasses, smoothLevels } from "../shaderAudio";

// Letterbox the viewport's aspect in the host: the backing store keeps its pixel size, only CSS size changes.
function fit(
  driver: RealtimeDriver,
  host: HTMLElement,
  scene: VideoScene,
): void {
  const [vw, vh] = scene.viewport;
  if (!vw || !vh) return;
  const hw = host.clientWidth;
  const hh = host.clientHeight;
  const s = Math.min(hw / vw, hh / vh);
  driver.resize(Math.round(vw * s), Math.round(vh * s));
}

export function VideoCanvas({
  scene,
  audioSources,
  trackIds,
  onDebug,
}: {
  scene: VideoScene;
  /** Which lane drives each shader pass's `uAudio`, by pass id (shaderAudio.ts) — empty for every song that shades nothing. */
  audioSources?: Readonly<Record<string, string>>;
  /** The compiled track order — how the engine's nameless `levels` array is indexed. */
  trackIds?: readonly string[];
  /** Per-lane drift, a few times a second. Omitted unless somebody is profiling — see profiling.ts. */
  onDebug?: (d: LaneDebug[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const driverRef = useRef<RealtimeDriver | null>(null);
  const clockRef = useRef<EngineClock | null>(null);
  const onDebugRef = useRef(onDebug);
  onDebugRef.current = onDebug;
  // In a ref for the same reason the debug callback is: the subscription must read a fresh map without losing the GL context.
  const sourcesRef = useRef(audioSources);
  sourcesRef.current = audioSources;
  const trackIdsRef = useRef(trackIds);
  trackIdsRef.current = trackIds;
  // The smoothed levels, held across reports — a ref, since nothing React draws depends on them.
  const levelsRef = useRef<Record<string, number>>({});
  // The store itself, not a slice of it: the playhead is fed to a clock, and feeding a clock is not drawing.
  const store = useEngineStore();

  // Rebuild the driver on a scene change: video content changes rarely, so recreating beats a diff path.
  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;
    const clock = new EngineClock();
    clockRef.current = clock;
    const driver = RealtimeDriver.create(host, scene, clock);
    if (!alive) {
      driver.destroy();
      return;
    }
    driverRef.current = driver;
    fit(driver, host, scene);
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
      driver.destroy();
      driverRef.current = null;
      clockRef.current = null;
    };
  }, [scene, store]);

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
      if (d) fit(d, host, scene);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [scene]);

  // The driver appends its own canvas and parked <video>s, so this host stays empty and merely centres them.
  return (
    <div
      ref={hostRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
    />
  );
}
