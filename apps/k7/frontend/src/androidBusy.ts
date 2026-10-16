// androidBusy.ts — tell the Android app what the engine is doing for this page, so it holds a foreground service
// and the screen while a take rolls, a track is armed or a rig sounds (engine/k7-runtime/docs/android.md).
// A no-op in a browser: only the app's views have `window.k7Android`.

import type { EngineStore } from "@studio/engine-browser/store";
import type { EngineState } from "@studio/engine-protocol";
import { useEffect } from "react";
import { soundingNow } from "./sounding";

/** How long a rig counts as live after its meters last moved: a pause between two songs is not the end of a set. */
export const LIVE_HOLD_MS = 30_000;

type Busy = "recording" | "armed" | "playing" | "live";

/** What the app is told, most demanding first; `soundedAt` is when soundingNow last held. */
export function engineBusy(
  s: Pick<EngineState, "playing" | "armed" | "recordEnabled" | "recorders">,
  soundedAt: number,
  now: number,
): Busy[] {
  const out: Busy[] = [];
  const capturing = Object.values(s.recorders ?? {}).some((r) => r.recording);
  if ((s.recordEnabled && s.playing) || capturing) out.push("recording");
  if (s.recordEnabled || s.armed.length > 0) out.push("armed");
  if (s.playing) out.push("playing");
  if (now - soundedAt < LIVE_HOLD_MS) out.push("live");
  return out;
}

interface Channel {
  postMessage(message: string): void;
}

/** Report `store`'s busy state to the Android app whenever it changes; nothing at all elsewhere. */
export function useAndroidBusy(store: EngineStore): void {
  useEffect(() => {
    const channel = (window as { k7Android?: Channel }).k7Android;
    if (!channel) return;
    let soundedAt = Number.NEGATIVE_INFINITY;
    let sent = "";
    const report = (reasons: Busy[]) => {
      const key = reasons.join(",");
      if (key === sent) return;
      sent = key;
      channel.postMessage(
        JSON.stringify({ t: "busy", from: "engine", reasons }),
      );
    };
    const check = () => {
      const s = store.getSnapshot();
      const now = Date.now();
      if (soundingNow(s)) soundedAt = now;
      report(engineBusy(s, soundedAt, now));
    };
    const unsubscribe = store.subscribe(check);
    // An idle session sends few frames, so the live hold is also checked on a clock of its own.
    const timer = window.setInterval(check, 5_000);
    const gone = () => report([]);
    addEventListener("pagehide", gone);
    check();
    return () => {
      unsubscribe();
      clearInterval(timer);
      removeEventListener("pagehide", gone);
      report([]);
    };
  }, [store]);
}
