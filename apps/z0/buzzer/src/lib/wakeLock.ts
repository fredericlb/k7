// Keeps the phone's screen on while the game runs, in three tiers — the native API, a silent
// canvas video, a near-silent oscillator — each tried only when the one above failed.
// Every tier wants a user gesture, so acquire() is called from a tap, never on mount.

export interface WakeLock {
  acquire(): Promise<void>;
  acquired(): boolean;
  // The native lock is released on a tab switch, so the next visibility must re-acquire.
  invalidate(): void;
  dispose(): void;
}

export function createWakeLock(): WakeLock {
  let acquired = false;
  let video: HTMLVideoElement | null = null;
  let audioCtx: AudioContext | null = null;

  async function acquire() {
    if (acquired) return;
    if ("wakeLock" in navigator) {
      try {
        await (
          navigator as Navigator & {
            wakeLock: { request(t: string): Promise<unknown> };
          }
        ).wakeLock.request("screen");
        acquired = true;
        return;
      } catch {
        /* not available over HTTP — fall through */
      }
    }
    if (!video) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const stream = canvas.captureStream(1);
        const v = document.createElement("video");
        v.setAttribute("playsinline", "");
        v.setAttribute("muted", "");
        v.muted = true;
        v.style.cssText =
          "position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01";
        v.srcObject = stream;
        document.body.appendChild(v);
        video = v;
      } catch {
        /* captureStream not supported */
      }
    }
    if (video) {
      try {
        await video.play();
        acquired = true;
        return;
      } catch {
        /* play blocked */
      }
    }
    if (!audioCtx) {
      try {
        audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        acquired = true;
      } catch {
        /* AudioContext not supported */
      }
    }
  }

  return {
    acquire,
    acquired: () => acquired,
    invalidate: () => {
      acquired = false;
    },
    dispose: () => {
      if (video) {
        video.pause();
        video.remove();
        video = null;
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
    },
  };
}
