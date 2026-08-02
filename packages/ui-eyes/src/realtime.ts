// realtime.ts — draw the viewport live against the engine's playhead, with one <video>
// per LAYER (a layer shows one clip at a time, so per-clip elements would mean N decoders
// for one picture). The engine and each <video> drift, corrected two-speed: playbackRate
// for a small drift, a hard seek for a jump. Full rationale: docs/realtime.md.

import type { EngineClock } from "./clock";
import { Compositor } from "./compositor";
import type { VideoLayer, VideoScene } from "./scene";
import { activeAt } from "./timeline";

const HARD_SEEK = 0.25; // s of error that forces a seek rather than a nudge
const SOFT_EPS = 0.008; // ≈ a quarter-frame at 30fps; below this, nudging chases quantization
const NUDGE_K = 1.5; // playbackRate = 1 - err*K, i.e. speed up when behind
const SETTLE_MS = 200; // after a seek, leave the rate alone while the decoder catches up

// Per-layer runtime state beside its <video>. `el` is null for a SHAPE layer: no media to decode, no clock to chase.
interface Lane {
  layer: VideoLayer;
  el: HTMLVideoElement | null;
  currentSrc: string | null; // the clip src the element is loaded with
  settleUntil: number; // performance.now() before which we don't nudge
}

// The frontend can read this to show a drift debug line (see the plan's verification).
export interface LaneDebug {
  id: string;
  active: boolean;
  errMs: number;
  rate: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export class RealtimeDriver {
  private comp: Compositor;
  private lanes: Lane[];
  private raf = 0;
  private disposed = false;
  private debug: LaneDebug[] = [];

  private constructor(
    comp: Compositor,
    lanes: Lane[],
    private readonly clock: EngineClock,
  ) {
    this.comp = comp;
    this.lanes = lanes;
    // A seek/loop/transport edge: land every element on its exact frame at once.
    clock.onSeek = () => this.reseekAll();
  }

  static create(
    host: HTMLElement,
    scene: VideoScene,
    clock: EngineClock,
  ): RealtimeDriver {
    const comp = Compositor.create(host, scene);
    const lanes: Lane[] = scene.layers.map((layer) => {
      // A shape layer has no media — the compositor draws its fills, so it needs no element and no drift control.
      if (layer.shapes?.length)
        return { layer, el: null, currentSrc: null, settleUntil: 0 };
      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      // Parked but decodable: 1px + invisible, NOT display:none.
      el.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
      host.appendChild(el);
      return { layer, el, currentSrc: null, settleUntil: 0 };
    });
    const driver = new RealtimeDriver(comp, lanes, clock);
    driver.loop();
    return driver;
  }

  // One rAF tick per lane: pick the active clip, keep src and play/pause in step, correct drift, upload the frame.
  private loop = (): void => {
    if (this.disposed) return;
    const t = this.clock.nowSec();
    const playing = this.clock.isPlaying();
    const visible = new Set<string>();
    this.debug = [];

    for (const lane of this.lanes) {
      // A hidden layer is omitted, exactly as export does — otherwise preview would show a track the render drops.
      if (lane.layer.hidden) {
        this.park(lane);
        continue;
      }

      // A shape layer draws while unhidden: nothing to decode or seek, so just mark it drawable.
      if (!lane.el) {
        visible.add(lane.layer.id);
        this.debug.push({ id: lane.layer.id, active: true, errMs: 0, rate: 1 });
        continue;
      }

      const hit = activeAt(lane.layer, t);
      if (!hit) {
        // Nothing on this lane now — pause and leave it out of the composite.
        this.park(lane);
        continue;
      }

      // Switch source at a cut. A load resets currentTime, so seek and let the drift control settle it from there.
      if (lane.currentSrc !== hit.clip.src) {
        lane.el.src = hit.clip.src;
        lane.currentSrc = hit.clip.src;
        lane.settleUntil = performance.now() + SETTLE_MS;
      }

      const want = hit.sourceTime;

      // Past the source's material, currentTime clamps short and the hard-seek below would fire every frame. Match
      // export, which skips a layer with no sample here: park it rather than thrash the decoder toward a missing frame.
      if (Number.isFinite(lane.el.duration) && want >= lane.el.duration) {
        this.park(lane);
        continue;
      }

      const err = lane.el.currentTime - want; // + == the video is AHEAD of the song

      if (Math.abs(err) > HARD_SEEK) {
        // A visible desync: flush to the right frame and let it settle before nudging.
        this.seekLane(lane, want);
      } else if (
        playing &&
        Math.abs(err) > SOFT_EPS &&
        performance.now() > lane.settleUntil
      ) {
        // Small, steady drift: speed up if behind, slow down if ahead. Invisible.
        lane.el.playbackRate = clamp(1 - err * NUDGE_K, 0.92, 1.08);
      } else {
        lane.el.playbackRate = 1;
      }

      // Keep the element's transport in step with the song's.
      if (playing && lane.el.paused) void lane.el.play().catch(() => {});
      if (!playing && !lane.el.paused) lane.el.pause();

      // Upload the frame and mark the lane drawable; texImage2D from a <video> is cheap enough to do every tick.
      this.comp.upload(lane.layer.id, lane.el);
      visible.add(lane.layer.id);
      this.debug.push({
        id: lane.layer.id,
        active: true,
        errMs: Math.round(err * 1000),
        rate: lane.el.playbackRate,
      });
    }

    this.comp.draw(visible);
    this.raf = requestAnimationFrame(this.loop);
  };

  // Park a lane showing nothing this tick — off, hidden or past its source: pause it and leave it out of the composite.
  private park(lane: Lane): void {
    if (lane.el && !lane.el.paused) lane.el.pause();
    this.debug.push({ id: lane.layer.id, active: false, errMs: 0, rate: 1 });
  }

  // Hard-seek: pause, jump to the exact frame, resume if rolling. Pausing first lands a stop on the right still.
  private seekLane(lane: Lane, want: number): void {
    const el = lane.el;
    if (!el) return; // a shape layer has no element to seek
    el.playbackRate = 1;
    lane.settleUntil = performance.now() + SETTLE_MS;
    const resume = this.clock.isPlaying();
    el.pause();
    try {
      el.currentTime = Math.max(0, want);
    } catch {
      /* the element may not be ready to seek yet; the next tick retries */
    }
    if (resume) {
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked);
        if (!this.disposed && this.clock.isPlaying())
          void el.play().catch(() => {});
      };
      el.addEventListener("seeked", onSeeked);
    }
  }

  // Re-seek every lane to the current playhead — the clock's onSeek hook (a scrub, a loop, a play/stop edge).
  private reseekAll(): void {
    const t = this.clock.nowSec();
    for (const lane of this.lanes) {
      if (!lane.el) continue; // shape layers: nothing to re-seek
      if (lane.layer.hidden) {
        lane.el.pause();
        continue;
      }
      const hit = activeAt(lane.layer, t);
      if (!hit) {
        lane.el.pause();
        continue;
      }
      if (lane.currentSrc !== hit.clip.src) {
        lane.el.src = hit.clip.src;
        lane.currentSrc = hit.clip.src;
      }
      this.seekLane(lane, hit.sourceTime);
    }
  }

  // The most recent per-lane drift snapshot, for a debug readout in the pane.
  debugState(): LaneDebug[] {
    return this.debug;
  }

  resize(cssW: number, cssH: number): void {
    this.comp.resize(cssW, cssH);
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clock.onSeek = undefined;
    for (const lane of this.lanes) {
      if (!lane.el) continue; // shape layers own no element
      lane.el.pause();
      lane.el.removeAttribute("src");
      lane.el.load();
      lane.el.remove();
    }
    this.comp.destroy();
  }
}
