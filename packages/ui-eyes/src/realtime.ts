// realtime.ts — draw the viewport live against a SeekingClock (an engine's playhead, or a
// transport of the host's own). One <video> per LAYER, and a SECOND one only on a lane that
// dissolves: a lane shows one clip at a time except across a transition, so a per-clip element
// would still mean N decoders for one picture. The clock and each <video> drift, corrected
// two-speed: playbackRate for a small drift, a hard seek for a jump. A document edit is a
// setScene, never a new driver: elements are kept by the src they hold (lanes.ts).
// Full rationale: docs/realtime.md, and song-video/docs/transitions.md.

import { type LensOpener, localLens } from "./camera";
import type { SeekingClock } from "./clock";
import type { LayerBlend } from "./compositor";
import { Compositor } from "./compositor";
import { DrawGate, STILL_STAMP, UploadMemo, videoStamp } from "./frameGate";
import { buildLanes, closeLive, type Lane, releaseVideo } from "./lanes";
import { StaticMedia } from "./media";
import { type Motion, slotMotions } from "./motion";
import type { VideoScene } from "./scene";
import {
  type Active,
  layerFrameAt,
  shapesVisibleAt,
  slotEffects,
} from "./timeline";

const HARD_SEEK = 0.25; // s of error that forces a seek rather than a nudge
const SOFT_EPS = 0.008; // ≈ a quarter-frame at 30fps; below this, nudging chases quantization
const NUDGE_K = 1.5; // playbackRate = 1 - err*K, i.e. speed up when behind
const SETTLE_MS = 200; // after a seek, leave the rate alone while the decoder catches up
const MIN_RATE = 0.0625; // the slowest playbackRate browsers play; below it, and at 0 or backwards, the element is stepped
const MAX_RATE = 16; // …and the fastest
const STEP_EPS = 1 / 60; // a stepped element is re-seeked once it is half a frame off at 30 fps

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
  private lanes: Lane[] = [];
  private scene: VideoScene;
  // The pictures drawn with no element — stills and captions — one decode or one draw each (media.ts).
  private media: StaticMedia;
  private raf = 0;
  private disposed = false;
  // Read by a lens still opening: it may land after the driver it was opened for is gone.
  private gone = () => this.disposed;
  // Filled only once somebody read it: the readout polls at 5 Hz, and only while profiling.
  private debug: LaneDebug[] = [];
  private debugWanted = false;
  // What each slot already holds and what the screen already shows, so an unchanged frame costs nothing (frameGate.ts).
  private uploads = new UploadMemo();
  private drawGate = new DrawGate();
  private audioRev = 0;
  // The frame's collections, cleared and refilled each tick rather than allocated anew.
  private visible = new Set<string>();
  private blends = new Map<string, LayerBlend>();
  private motions = new Map<string, [Motion | null, Motion | null]>();
  private effects = new Map<string, [string | null, string | null]>();
  private used = new Set<number>();
  private uploaded = false;

  private constructor(
    private readonly comp: Compositor,
    private readonly host: HTMLElement,
    private readonly clock: SeekingClock,
    private readonly openLens: LensOpener,
    scene: VideoScene,
  ) {
    this.scene = scene;
    this.media = new StaticMedia(scene.viewport[0], scene.viewport[1]);
    this.lanes = buildLanes([], scene, host, openLens, this.gone);
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
    const driver = new RealtimeDriver(comp, host, clock, openLens, scene);
    driver.watchSight(host);
    driver.loop();
    return driver;
  }

  /** The scene being drawn — a host compares it to skip a setScene that would change nothing. */
  get current(): VideoScene {
    return this.scene;
  }

  /** Draw a new scene with the same context: elements still playing a src are kept, the rest made or released. */
  setScene(scene: VideoScene): void {
    if (scene === this.scene || this.disposed) return;
    this.scene = scene;
    this.comp.setScene(scene);
    this.lanes = buildLanes(
      this.lanes,
      scene,
      this.host,
      this.openLens,
      this.gone,
    );
    this.slots.clear();
    this.media.reset(scene.viewport[0], scene.viewport[1]);
    // The compositor's textures were rebuilt empty: every slot uploads again, and the frame is drawn.
    this.uploads.forget();
    this.drawGate.invalidate();
    // Stopped, nothing chases the clock, so an edit that moved a shot is landed here; rolling, the drift control does it.
    if (!this.clock.isPlaying()) this.reseekAll(STEP_EPS);
  }

  /** Which element should carry `active`: the one holding that clip, else one holding its src, else any free one. */
  // INDEX first: a shot dissolving into itself has one src on two placements, and each keeps its own element.
  private claim(lane: Lane, active: Active, used: Set<number>): number | null {
    for (let e = 0; e < lane.els.length; e++)
      if (!used.has(e) && lane.loaded[e] === active.index) {
        used.add(e);
        return e;
      }
    for (let e = 0; e < lane.els.length; e++)
      if (!used.has(e) && lane.srcs[e] === active.clip.src) {
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

  // One line of the debug readout, written only while somebody reads it.
  private note(id: string, active: boolean, errMs: number, rate: number): void {
    if (this.debugWanted) this.debug.push({ id, active, errMs, rate });
  }

  // Point element `e` at clip `active`, re-pointing its src only when the clip plays another file.
  private point(lane: Lane, e: number, active: Active): void {
    if (lane.srcs[e] !== active.clip.src) {
      lane.els[e].src = active.clip.src;
      lane.srcs[e] = active.clip.src;
    }
    lane.loaded[e] = active.index;
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
      this.point(lane, e, active);
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
      this.note(lane.layer.id, true, Math.round(err * 1000), 0);
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

    this.note(lane.layer.id, true, Math.round(err * 1000), el.playbackRate);
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
      // Back in sight: every element lands on its frame at once, as after a seek, and the frame is drawn anew.
      if (seen && !this.onScreen) {
        this.reseekAll();
        this.uploads.forget();
        this.drawGate.invalidate();
      }
      this.onScreen = seen;
    });
    this.sight.observe(host);
  }

  // One tick per lane: pick the frame, keep each element in step, upload into its slot, draw.
  private frame(): void {
    // Out of sight: the elements are paused once and nothing is drawn — the loop itself stays, to notice the return.
    if (!this.onScreen) {
      if (!this.parked) {
        this.debug.length = 0;
        for (const lane of this.lanes) this.park(lane);
        this.parked = true;
      }
      return;
    }
    this.parked = false;
    const t = this.clock.nowSec();
    const playing = this.clock.isPlaying();
    const visible = this.visible;
    const blends = this.blends;
    const motions = this.motions;
    const effects = this.effects;
    const used = this.used;
    visible.clear();
    blends.clear();
    motions.clear();
    effects.clear();
    this.debug.length = 0;
    this.uploaded = false;

    for (const lane of this.lanes) {
      const id = lane.layer.id;
      // A hidden layer is omitted, exactly as export does — otherwise preview would show a track the render drops.
      if (lane.layer.hidden) {
        this.park(lane);
        continue;
      }

      // A LIVE lane draws whatever the lens shows, with no clip, seek or drift — and while STOPPED too, which is what "live" means.
      if (lane.live) {
        if (lane.live.stream) {
          visible.add(id);
          // A camera has no position to compare, so its every tick is a new picture.
          this.upload(id, lane.live.el, 0, null);
        }
        this.note(id, !!lane.live.stream, 0, 1);
        continue;
      }

      // A shape layer has nothing to decode: its ACTIVATION spans say when it draws, a layer stating none draws throughout (docs/shapes.md).
      if (!lane.els.length) {
        const on = shapesVisibleAt(lane.layer, t);
        if (on) visible.add(id);
        // An activation may animate too, which moves the whole lane of shapes (docs/motion.md).
        if (on && lane.layer.clips.length)
          motions.set(
            id,
            slotMotions(layerFrameAt(lane.layer, t), t, this.tuples(id).m),
          );
        this.note(id, on, 0, 1);
        continue;
      }

      const frame = layerFrameAt(lane.layer, t);
      if (!frame.from && !frame.to) {
        // Nothing on this lane now — pause and leave it out of the composite.
        this.park(lane);
        continue;
      }

      // Slot 0 is the outgoing picture and slot 1 the incoming one; a cut uses slot 0 alone.
      used.clear();
      const from = frame.blend
        ? !!frame.from && this.show(lane, frame.from, 0, playing)
        : !!frame.to && this.show(lane, frame.to, 0, playing);
      const to =
        !!frame.blend && !!frame.to && this.show(lane, frame.to, 1, playing);
      // Every element this lane did not need this tick: paused, so an idle decoder costs nothing.
      for (let e = 0; e < lane.els.length; e++)
        if (!used.has(e) && !lane.els[e].paused) lane.els[e].pause();

      if (!from && !to) {
        this.note(id, false, 0, 1);
        continue;
      }
      visible.add(id);
      const tuple = this.tuples(id);
      motions.set(id, slotMotions(frame, t, tuple.m));
      effects.set(id, slotEffects(frame, tuple.e));
      // Held at 0 while the incoming side has no frame yet, rather than blending against black.
      if (frame.blend)
        blends.set(id, {
          name: frame.blend.name,
          progress: to || !frame.to ? frame.blend.progress : 0,
          from,
          to,
          ...(frame.blend.stretch ? { stretch: frame.blend.stretch } : {}),
        });
    }

    // Motions, effects and blend progress all follow from `t`; what a lane SHOWS does not, so it is in the key too.
    let shown = "";
    for (const id of visible) {
      const b = blends.get(id);
      shown += b ? `${id}:${+b.from}${+b.to},` : `${id},`;
    }
    const key = `${t}|${shown}|${this.audioRev}|${this.comp.revision}`;
    if (!this.drawGate.need(this.uploaded, playing, key)) return;
    // The live half of a shader's uniforms, refreshed per frame rather than per document — see docs/passes.md.
    this.comp.setLive(t, this.audio);
    this.comp.draw(visible, blends, motions, effects);
  }

  // Put `active` into `slot`: a still or caption from its one picture, a shot from the element that carries it.
  private show(
    lane: Lane,
    active: Active,
    slot: 0 | 1,
    playing: boolean,
  ): boolean {
    const id = lane.layer.id;
    if (StaticMedia.owns(active.clip)) {
      const pic = this.media.picture(active.clip, active.sourceTime);
      if (!pic) return false;
      this.upload(id, pic, slot, STILL_STAMP);
      return true;
    }
    const e = this.claim(lane, active, this.used);
    if (e === null || !this.steer(lane, e, active, playing)) return false;
    this.upload(id, lane.els[e], slot, videoStamp(lane.els[e]));
    return true;
  }

  // Every upload goes through the memo: a slot that already holds this picture is not handed it again.
  private upload(
    id: string,
    src: TexImageSource,
    slot: 0 | 1,
    stamp: string | null,
  ): void {
    if (!this.uploads.need(id, slot, src, stamp)) return;
    this.comp.upload(id, src, slot);
    this.uploaded = true;
  }

  // The motion and effect tuples a lane refills each tick, so a frame allocates none.
  private slots = new Map<
    string,
    { m: [Motion | null, Motion | null]; e: [string | null, string | null] }
  >();
  private tuples(id: string) {
    let t = this.slots.get(id);
    if (!t) {
      t = { m: [null, null], e: [null, null] };
      this.slots.set(id, t);
    }
    return t;
  }

  /** The audio level each pass is driven by, 0..1 by pass id — PUSHED by the host, and held here since the rates differ. */
  private audio: Record<string, number> = {};
  setAudio(byPass: Readonly<Record<string, number>>): void {
    const ids = Object.keys(byPass);
    const same =
      ids.length === Object.keys(this.audio).length &&
      ids.every((id) => this.audio[id] === byPass[id]);
    if (same) return;
    this.audio = { ...byPass };
    this.audioRev++;
  }

  // Park a lane showing nothing this tick — off, hidden or past its source: pause it and leave it out of the composite.
  private park(lane: Lane): void {
    for (const el of lane.els) if (!el.paused) el.pause();
    this.note(lane.layer.id, false, 0, 1);
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
  // A `tolerance` leaves an element already that close to its frame alone, so an edit costs no needless seek.
  private reseekAll(tolerance = 0): void {
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
        const moved = lane.srcs[e] !== active.clip.src;
        if (lane.loaded[e] !== active.index) this.point(lane, e, active);
        const off = Math.abs(lane.els[e].currentTime - active.sourceTime);
        if (tolerance > 0 && !moved && off <= tolerance) continue;
        this.seekEl(lane, e, active.sourceTime);
      }
      for (let e = 0; e < lane.els.length; e++)
        if (!used.has(e)) lane.els[e].pause();
    }
  }

  // The most recent per-lane drift snapshot, for a debug readout in the pane.
  debugState(): LaneDebug[] {
    this.debugWanted = true;
    return this.debug.slice();
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
      for (const el of lane.els) releaseVideo(el);
      if (lane.live) closeLive(lane.live);
    }
    this.comp.destroy();
  }
}
