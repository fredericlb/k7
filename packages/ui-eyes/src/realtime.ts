// realtime.ts — draw the viewport live against a SeekingClock (an engine's playhead, or a
// transport of the host's own). One <video> per LAYER, and a SECOND one only on a lane that
// dissolves: a lane shows one clip at a time except across a transition, so a per-clip element
// would still mean N decoders for one picture. The clock and each <video> drift, corrected
// two-speed: playbackRate for a small drift, a hard seek for a jump.
// Full rationale: docs/realtime.md, and song-video/docs/transitions.md.

import { type LensOpener, localLens } from "./camera";
import type { SeekingClock } from "./clock";
import type { LayerBlend } from "./compositor";
import { Compositor } from "./compositor";
import { type Motion, slotMotions } from "./motion";
import type { VideoLayer, VideoScene } from "./scene";
import { type Active, layerFrameAt, shapesVisibleAt } from "./timeline";

const HARD_SEEK = 0.25; // s of error that forces a seek rather than a nudge
const SOFT_EPS = 0.008; // ≈ a quarter-frame at 30fps; below this, nudging chases quantization
const NUDGE_K = 1.5; // playbackRate = 1 - err*K, i.e. speed up when behind
const SETTLE_MS = 200; // after a seek, leave the rate alone while the decoder catches up
const MIN_RATE = 0.0625; // the slowest playbackRate browsers play; below it, and at 0 or backwards, the element is stepped
const MAX_RATE = 16; // …and the fastest
const STEP_EPS = 1 / 60; // a stepped element is re-seeked once it is half a frame off at 30 fps

// Per-layer runtime state. `els` is empty for a SHAPE layer: no media to decode, no clock to chase.
// The second element exists only where a `fade_in` needs two pictures at once.
interface Lane {
  layer: VideoLayer;
  els: HTMLVideoElement[];
  loaded: (number | null)[]; // which clip INDEX each element is loaded with
  settleUntil: number[];
  /** A LIVE lane: one element carrying a camera's stream. It chases no clock and holds no clip —
   *  a lens has no timeline — so every seek and drift rule below skips it (docs/camera.md). */
  live?: {
    el: HTMLVideoElement;
    stream: MediaStream | null;
    problem: string | null;
    /** The lens's own release, beyond stopping its tracks. */
    close?: () => void;
  };
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

/** The parked, decodable element a lane draws from — the same 1px trick a clip's uses. */
function liveElement(host: HTMLElement): HTMLVideoElement {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.style.cssText =
    "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
  host.appendChild(el);
  return el;
}

/** Open the lens a layer names and hand it to `live.el`. Fire and forget: the first frames arrive
 *  whenever the browser and the person granting permission agree, and the lane draws nothing until
 *  they do. Every failure is CARRIED rather than thrown — a refused camera must not take the whole
 *  viewport down with it, and the other layers have pictures to show. See docs/camera.md. */
async function openCamera(
  label: string,
  live: NonNullable<Lane["live"]>,
  open: LensOpener,
  gone: () => boolean,
) {
  const lens = await open(label);
  // The driver was destroyed while the lens opened (a permission prompt, a slow device): released here, or the lamp stays lit.
  if (gone()) {
    for (const track of lens.stream?.getTracks() ?? []) track.stop();
    lens.close?.();
    return;
  }
  live.close = lens.close;
  live.problem = lens.problem;
  if (!lens.stream) return;
  live.stream = lens.stream;
  live.el.srcObject = lens.stream;
  await live.el.play().catch(() => undefined);
}

export class RealtimeDriver {
  private comp: Compositor;
  private lanes: Lane[];
  private raf = 0;
  private disposed = false;
  private debug: LaneDebug[] = [];

  private constructor(
    comp: Compositor,
    lanes: Lane[],
    private readonly clock: SeekingClock,
  ) {
    this.comp = comp;
    this.lanes = lanes;
    // A seek/loop/transport edge: land every element on its exact frame at once.
    clock.onSeek = () => this.reseekAll();
  }

  static create(
    host: HTMLElement,
    scene: VideoScene,
    clock: SeekingClock,
    /** Where a live lane's picture comes from; the default is this browser's own camera. */
    openLens: LensOpener = localLens,
  ): RealtimeDriver {
    const comp = Compositor.create(host, scene);
    // Read by a lens still opening: it may land after the driver it was opened for is gone.
    let driver: RealtimeDriver | null = null;
    const lanes: Lane[] = scene.layers.map((layer) => {
      // A LIVE lane: one element, one stream, and nothing to decode or chase (docs/camera.md).
      if (layer.camera !== undefined) {
        const el = liveElement(host);
        const live: Lane["live"] = { el, stream: null, problem: null };
        openCamera(layer.camera, live, openLens, () => !!driver?.disposed);
        return { layer, els: [], loaded: [], settleUntil: [], live };
      }
      // A shape layer has no media — the compositor draws its fills, so it needs no element and no drift control.
      if (layer.shapes?.length)
        return { layer, els: [], loaded: [], settleUntil: [] };
      // Two decoders ONLY where a fade_in asks for two pictures; a fade_out goes to nothing.
      const n = layer.clips.some((c) => c.fadeIn) ? 2 : 1;
      const els = Array.from({ length: n }, () => {
        const el = document.createElement("video");
        el.muted = true;
        el.playsInline = true;
        el.preload = "auto";
        el.crossOrigin = "anonymous";
        // Parked but decodable: 1px + invisible, NOT display:none.
        el.style.cssText =
          "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
        host.appendChild(el);
        return el;
      });
      return {
        layer,
        els,
        loaded: els.map(() => null),
        settleUntil: els.map(() => 0),
      };
    });
    driver = new RealtimeDriver(comp, lanes, clock);
    driver.watchSight(host);
    driver.loop();
    return driver;
  }

  /** Which element should carry `active`: the one already holding that clip, else any free one. */
  // By clip INDEX and never by src: a shot dissolving into itself has one src on two placements.
  private claim(lane: Lane, active: Active, used: Set<number>): number | null {
    for (let e = 0; e < lane.els.length; e++)
      if (!used.has(e) && lane.loaded[e] === active.index) {
        used.add(e);
        return e;
      }
    for (let e = 0; e < lane.els.length; e++)
      if (!used.has(e)) {
        used.add(e);
        return e;
      }
    return null;
  }

  /** Point element `e` at `active`'s clip, correct its drift, and answer whether it has a frame to give. */
  private steer(
    lane: Lane,
    e: number,
    active: Active,
    playing: boolean,
  ): boolean {
    const el = lane.els[e];
    // Switch source at a cut. A load resets currentTime, so seek and let the drift control settle it from there.
    if (lane.loaded[e] !== active.index) {
      if (el.src !== active.clip.src) el.src = active.clip.src;
      lane.loaded[e] = active.index;
      lane.settleUntil[e] = performance.now() + SETTLE_MS;
    }

    const want = active.sourceTime;
    // Past the source's material — either end, a reverse reaching its first frame — the hard seek would fire every frame.
    if ((Number.isFinite(el.duration) && want >= el.duration) || want < 0) {
      if (!el.paused) el.pause();
      return false;
    }

    const err = el.currentTime - want; // + == the video is AHEAD of the song
    const speed = active.clip.speed ?? 1;
    // A freeze, a reverse, or a rate no decoder plays: the element is PARKED and stepped by seeks (docs/realtime.md).
    if (!(speed >= MIN_RATE && speed <= MAX_RATE)) {
      if (!el.paused) el.pause();
      if (Math.abs(err) > STEP_EPS && !el.seeking) this.seekEl(lane, e, want);
      this.debug.push({
        id: lane.layer.id,
        active: true,
        errMs: Math.round(err * 1000),
        rate: 0,
      });
      return true;
    }
    if (Math.abs(err) > HARD_SEEK) {
      // A visible desync: flush to the right frame and let it settle before nudging.
      this.seekEl(lane, e, want);
    } else if (
      playing &&
      Math.abs(err) > SOFT_EPS &&
      performance.now() > lane.settleUntil[e]
    ) {
      // Small, steady drift: speed up if behind, slow down if ahead — around the shot's own rate. Invisible.
      el.playbackRate = speed * clamp(1 - err * NUDGE_K, 0.92, 1.08);
    } else {
      el.playbackRate = speed;
    }

    // Keep the element's transport in step with the song's.
    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();

    this.debug.push({
      id: lane.layer.id,
      active: true,
      errMs: Math.round(err * 1000),
      rate: el.playbackRate,
    });
    return true;
  }

  // Scheduled FIRST: one frame that throws (a closed VideoFrame, a decode fault) must not stop the picture for good.
  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    try {
      this.frame();
    } catch (e) {
      // Said once per driver, not sixty times a second.
      if (!this.frameFault) console.error("[viewport] a frame failed", e);
      this.frameFault = true;
    }
  };
  private frameFault = false;

  // Whether the host is on screen: a pane is hidden rather than unmounted, and drawing nobody sees costs a GPU and a decoder.
  private onScreen = true;
  private parked = false;
  private sight: IntersectionObserver | null = null;

  private watchSight(host: HTMLElement): void {
    if (typeof IntersectionObserver === "undefined") return;
    this.sight = new IntersectionObserver((entries) => {
      const seen = entries.some((e) => e.isIntersecting);
      // Back in sight: every element lands on its frame at once, as after a seek.
      if (seen && !this.onScreen) this.reseekAll();
      this.onScreen = seen;
    });
    this.sight.observe(host);
  }

  // One tick per lane: pick the frame, keep each element in step, upload into its slot, draw.
  private frame(): void {
    // Out of sight: the elements are paused once and nothing is drawn — the loop itself stays, to notice the return.
    if (!this.onScreen) {
      if (!this.parked) {
        this.debug = [];
        for (const lane of this.lanes) this.park(lane);
        this.parked = true;
      }
      return;
    }
    this.parked = false;
    const t = this.clock.nowSec();
    const playing = this.clock.isPlaying();
    const visible = new Set<string>();
    const blends = new Map<string, LayerBlend>();
    const motions = new Map<string, [Motion | null, Motion | null]>();
    this.debug = [];

    for (const lane of this.lanes) {
      // A hidden layer is omitted, exactly as export does — otherwise preview would show a track the render drops.
      if (lane.layer.hidden) {
        this.park(lane);
        continue;
      }

      // A LIVE lane draws whatever the lens is showing: no clip, no seek, no drift — and it is
      // drawn while the transport is STOPPED too, which is what "live" has to mean.
      if (lane.live) {
        if (lane.live.stream) {
          visible.add(lane.layer.id);
          this.comp.upload(lane.layer.id, lane.live.el, 0);
        }
        this.debug.push({
          id: lane.layer.id,
          active: !!lane.live.stream,
          errMs: 0,
          rate: 1,
        });
        continue;
      }

      // A shape layer has nothing to decode or seek: its own ACTIVATION spans say when it draws,
      // and a layer stating none draws throughout — the rule is timeline.ts's (docs/shapes.md).
      if (!lane.els.length) {
        const on = shapesVisibleAt(lane.layer, t);
        if (on) visible.add(lane.layer.id);
        // An activation may animate too, which moves the whole lane of shapes (docs/motion.md).
        if (on && lane.layer.clips.length)
          motions.set(
            lane.layer.id,
            slotMotions(layerFrameAt(lane.layer, t), t),
          );
        this.debug.push({ id: lane.layer.id, active: on, errMs: 0, rate: 1 });
        continue;
      }

      const frame = layerFrameAt(lane.layer, t);
      if (!frame.from && !frame.to) {
        // Nothing on this lane now — pause and leave it out of the composite.
        this.park(lane);
        continue;
      }

      // Slot 0 is the outgoing picture and slot 1 the incoming one; a cut uses slot 0 alone.
      const wanted: { active: Active; slot: 0 | 1 }[] = frame.blend
        ? [
            ...(frame.from ? [{ active: frame.from, slot: 0 as const }] : []),
            ...(frame.to ? [{ active: frame.to, slot: 1 as const }] : []),
          ]
        : frame.to
          ? [{ active: frame.to, slot: 0 as const }]
          : [];

      const used = new Set<number>();
      let from = false;
      let to = false;
      for (const w of wanted) {
        const e = this.claim(lane, w.active, used);
        if (e === null) continue;
        if (!this.steer(lane, e, w.active, playing)) continue;
        this.comp.upload(lane.layer.id, lane.els[e], w.slot);
        if (w.slot === 0) from = true;
        else to = true;
      }
      // Every element this lane did not need this tick: paused, so an idle decoder costs nothing.
      for (let e = 0; e < lane.els.length; e++)
        if (!used.has(e) && !lane.els[e].paused) lane.els[e].pause();

      if (!from && !to) {
        this.debug.push({
          id: lane.layer.id,
          active: false,
          errMs: 0,
          rate: 1,
        });
        continue;
      }
      visible.add(lane.layer.id);
      motions.set(lane.layer.id, slotMotions(frame, t));
      // Held at 0 while the incoming side has no frame yet, rather than blending against black.
      if (frame.blend)
        blends.set(lane.layer.id, {
          name: frame.blend.name,
          progress: to || !frame.to ? frame.blend.progress : 0,
          from,
          to,
          ...(frame.blend.stretch ? { stretch: frame.blend.stretch } : {}),
        });
    }

    // The live half of a shader's uniforms, refreshed per frame rather than per document — see docs/passes.md.
    this.comp.setLive(t, this.audio);
    this.comp.draw(visible, blends, motions);
  }

  /** The audio level each pass is driven by, 0..1 by pass id — PUSHED by the host, and held here since the rates differ. */
  private audio: Record<string, number> = {};
  setAudio(byPass: Readonly<Record<string, number>>): void {
    this.audio = { ...byPass };
  }

  // Park a lane showing nothing this tick — off, hidden or past its source: pause it and leave it out of the composite.
  private park(lane: Lane): void {
    for (const el of lane.els) if (!el.paused) el.pause();
    this.debug.push({ id: lane.layer.id, active: false, errMs: 0, rate: 1 });
  }

  // Hard-seek: pause, jump to the exact frame, resume if rolling. Pausing first lands a stop on the right still.
  private seekEl(lane: Lane, e: number, want: number): void {
    const el = lane.els[e];
    el.playbackRate = 1;
    lane.settleUntil[e] = performance.now() + SETTLE_MS;
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
  // BOTH elements: scrubbing into the middle of a dissolve must land the pair, not one and a stale frame.
  private reseekAll(): void {
    const t = this.clock.nowSec();
    for (const lane of this.lanes) {
      if (!lane.els.length) continue; // shape layers: nothing to re-seek
      if (lane.layer.hidden) {
        for (const el of lane.els) el.pause();
        continue;
      }
      const frame = layerFrameAt(lane.layer, t);
      const actives = [frame.from, frame.to].filter((a): a is Active => !!a);
      if (!actives.length) {
        for (const el of lane.els) el.pause();
        continue;
      }
      const used = new Set<number>();
      for (const active of actives) {
        const e = this.claim(lane, active, used);
        if (e === null) continue;
        if (lane.loaded[e] !== active.index) {
          if (lane.els[e].src !== active.clip.src)
            lane.els[e].src = active.clip.src;
          lane.loaded[e] = active.index;
        }
        this.seekEl(lane, e, active.sourceTime);
      }
      for (let e = 0; e < lane.els.length; e++)
        if (!used.has(e)) lane.els[e].pause();
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
    this.sight?.disconnect();
    this.clock.onSeek = undefined;
    for (const lane of this.lanes) {
      for (const el of lane.els) {
        el.pause();
        el.removeAttribute("src");
        el.load();
        el.remove();
      }
      // A camera left running is a lamp left on: the browser keeps the indicator lit and the
      // device held until the tab closes, on a surface you merely navigated away from.
      if (lane.live) {
        for (const track of lane.live.stream?.getTracks() ?? []) track.stop();
        lane.live.close?.();
        lane.live.el.srcObject = null;
        lane.live.el.remove();
      }
    }
    this.comp.destroy();
  }
}
