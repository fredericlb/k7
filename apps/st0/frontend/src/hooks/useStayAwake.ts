// useStayAwake.ts — hold the screen on for a surface nobody is touching. The Wake Lock API is
// gated on a SECURE context, which a tablet reaching this machine over the LAN has not got, so
// there is a second path: a muted inline video, which phone browsers keep the screen awake for.
// A lock is dropped by the browser on every hide, so it is re-taken when the page comes back.
// See ../../docs/external.md.

import { useEffect } from "react";

/** How often the decoy canvas is repainted — a track with no frames is a track a browser may idle. */
const DECOY_MS = 1000;

/** A playing video with a live track, and nothing to look at: 1×1, muted, inline, invisible. */
function playDecoy(): () => void {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  // No 2d context is no decoy; the caller has already tried the real lock and there is nothing left.
  if (!ctx) return () => {};
  let tick = 0;
  const paint = () => {
    tick = (tick + 1) % 2;
    ctx.fillStyle = tick ? "#000" : "#010101";
    ctx.fillRect(0, 0, 1, 1);
  };
  paint();
  const stream = canvas.captureStream?.(0);
  if (!stream) return () => {};
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.loop = true;
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
  el.srcObject = stream;
  document.body.appendChild(el);
  void el.play().catch(() => undefined);
  const timer = window.setInterval(() => {
    paint();
    // requestFrame is what makes a captureStream(0) track produce anything at all.
    for (const t of stream.getVideoTracks())
      (t as CanvasCaptureMediaStreamTrack).requestFrame?.();
  }, DECOY_MS);
  return () => {
    clearInterval(timer);
    for (const t of stream.getVideoTracks()) t.stop();
    el.srcObject = null;
    el.remove();
  };
}

/** Keep the screen lit while `on`. Best effort by construction: nothing here can be verified from
 *  script, and the failure — a tablet dimming mid-set — looks like a crash rather than a policy. */
export function useStayAwake(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let done = false;
    let sentinel: WakeLockSentinel | null = null;
    let stopDecoy: (() => void) | null = null;

    const take = async () => {
      if (done || sentinel) return;
      const wl = navigator.wakeLock;
      if (wl) {
        try {
          sentinel = await wl.request("screen");
          // Released by the browser on hide, and it is the listener below that takes it again.
          sentinel.addEventListener("release", () => {
            sentinel = null;
          });
          return;
        } catch {
          /* refused, or no screen lock on this device — the decoy is the rest of the answer */
        }
      }
      stopDecoy ??= playDecoy();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void take();
    };
    void take();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      done = true;
      document.removeEventListener("visibilitychange", onVisible);
      stopDecoy?.();
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [on]);
}
