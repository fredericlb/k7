// VideoCanvas.tsx — the React host for the eyes realtime renderer. The imperative-WebGL host
// pattern, deliberately: the `alive` unmount guard, the refs that keep the driver reading fresh
// callbacks without tearing down its GL context, and a ResizeObserver on the HOST (not the
// window) are each a bug already paid for once.
//
// It is HANDED the clock rather than owning one. In l8 this component built an EngineClock and
// fed it a reported playhead, because the engine was the authority; here the transport is, and
// two clocks for one position would be a drift with nothing to correct it against.

import type { TransportClock } from "@studio/ui-eyes/clock";
import { type LaneDebug, RealtimeDriver } from "@studio/ui-eyes/realtime";
import type { VideoScene } from "@studio/ui-eyes/scene";
import { useEffect, useRef } from "react";

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
  clock,
  onDebug,
}: {
  scene: VideoScene;
  clock: TransportClock;
  onDebug?: (d: LaneDebug[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const driverRef = useRef<RealtimeDriver | null>(null);
  const onDebugRef = useRef(onDebug);
  onDebugRef.current = onDebug;

  // Rebuild the driver on a scene change: video content changes rarely, so recreating beats a diff path.
  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;
    const driver = RealtimeDriver.create(host, scene, clock);
    if (!alive) {
      driver.destroy();
      return;
    }
    driverRef.current = driver;
    fit(driver, host, scene);

    // Poll the per-lane drift for the debug readout (not per-frame — the pane only needs it a few times a second).
    const dbg = onDebugRef.current
      ? window.setInterval(() => onDebugRef.current?.(driver.debugState()), 200)
      : 0;

    return () => {
      alive = false;
      if (dbg) clearInterval(dbg);
      driver.destroy();
      driverRef.current = null;
    };
  }, [scene, clock]);

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
