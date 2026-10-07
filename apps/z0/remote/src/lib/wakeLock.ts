// Keeps the phone's screen on: the Wake Lock API, else a looping 1px video, else a silent oscillator.
// The second and third tiers exist because the API needs a secure context, and the remote runs on HTTP on the LAN.

export class WakeLock {
  acquired = false;
  private video: HTMLVideoElement | null = null;
  private audioCtx: AudioContext | null = null;

  async acquire(): Promise<void> {
    if (this.acquired) return;
    if ("wakeLock" in navigator) {
      try {
        await (
          navigator as Navigator & {
            wakeLock: { request(t: string): Promise<unknown> };
          }
        ).wakeLock.request("screen");
        this.acquired = true;
        return;
      } catch {
        /* HTTP — fall through */
      }
    }
    if (!this.video) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const stream = canvas.captureStream(1);
        const video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.muted = true;
        video.style.cssText =
          "position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01";
        video.srcObject = stream;
        document.body.appendChild(video);
        this.video = video;
      } catch {
        /* unsupported */
      }
    }
    if (this.video) {
      try {
        await this.video.play();
        this.acquired = true;
        return;
      } catch {
        /* blocked */
      }
    }
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        this.acquired = true;
      } catch {
        /* unsupported */
      }
    }
  }

  release(): void {
    if (this.video) {
      this.video.pause();
      this.video.remove();
      this.video = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
