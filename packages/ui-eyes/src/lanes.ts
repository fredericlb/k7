// lanes.ts — the realtime driver's per-LAYER state, and which <video> elements a new scene can
// keep. An edit reaches the driver as a new scene; elements are matched to it by the src they
// already hold, so a shot that is still there keeps its decoder, its buffer and its position.
// The plan is pure, so it is tested with no DOM. See docs/realtime.md.

import type { LensOpener } from "./camera";
import { type LiveLane, liveElement, openCamera } from "./liveLane";
import type { VideoLayer, VideoScene } from "./scene";

// Per-layer runtime state. `els` is empty for a SHAPE layer: no media to decode, no clock to chase.
export interface Lane {
  layer: VideoLayer;
  els: HTMLVideoElement[];
  srcs: (string | null)[]; // the clip src each element was last pointed at, as written in the scene
  loaded: (number | null)[]; // which clip INDEX each element is loaded with
  settleUntil: number[];
  /** A LIVE lane: one element carrying a camera's stream, which chases no clock (docs/camera.md). */
  live?: LiveLane;
}

/** An element the old scene holds: the layer it served and the src it carries. */
export interface HeldElement {
  layer: string;
  src: string | null;
}

/** What a layer of the new scene asks for: how many elements, and the srcs its clips play. */
export interface LaneNeed {
  layer: string;
  srcs: readonly string[];
  count: number;
}

/** For each needed lane, per element, the held index it takes or -1 for a new one; `drop` is what nobody took. */
export interface ReusePlan {
  lanes: number[][];
  drop: number[];
}

/** How many <video> elements a layer needs: none for a camera or shapes, two where a `fade_in` dissolves. */
export function elementCount(layer: VideoLayer): number {
  if (layer.camera !== undefined || layer.shapes?.length) return 0;
  return layer.clips.some((c) => c.fadeIn) ? 2 : 1;
}

/** Match held elements to the new lanes: same layer and a src it plays, then any layer with that src, then same layer, then any. */
export function planReuse(
  held: readonly HeldElement[],
  needs: readonly LaneNeed[],
): ReusePlan {
  const free = held.map(() => true);
  const lanes = needs.map((n) => new Array<number>(n.count).fill(-1));
  const pass = (accept: (h: HeldElement, n: LaneNeed) => boolean) => {
    for (let i = 0; i < needs.length; i++)
      for (let s = 0; s < lanes[i].length; s++) {
        if (lanes[i][s] !== -1) continue;
        const j = held.findIndex((h, k) => free[k] && accept(h, needs[i]));
        if (j < 0) continue;
        free[j] = false;
        lanes[i][s] = j;
      }
  };
  const plays = (h: HeldElement, n: LaneNeed) =>
    h.src !== null && n.srcs.includes(h.src);
  pass((h, n) => h.layer === n.layer && plays(h, n));
  pass(plays);
  pass((h, n) => h.layer === n.layer);
  pass(() => true);
  const drop: number[] = [];
  for (let k = 0; k < held.length; k++) if (free[k]) drop.push(k);
  return { lanes, drop };
}

/** A clip's element: muted, parked 1px and invisible but NOT display:none, so it still decodes. */
function videoElement(host: HTMLElement): HTMLVideoElement {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  el.style.cssText =
    "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
  host.appendChild(el);
  return el;
}

/** Let an element go: its decoder and buffer are released, not merely detached. */
export function releaseVideo(el: HTMLVideoElement): void {
  el.pause();
  el.removeAttribute("src");
  el.load();
  el.remove();
}

/** Close a camera lane — a camera left running keeps the browser's indicator lit and the device held. */
export function closeLive(live: LiveLane): void {
  live.dropped = true;
  for (const track of live.stream?.getTracks() ?? []) track.stop();
  live.close?.();
  live.el.srcObject = null;
  live.el.remove();
}

/** The lanes of `scene`, keeping the elements `current` holds by the src they carry and the cameras by the lens they name. */
export function buildLanes(
  current: readonly Lane[],
  scene: VideoScene,
  host: HTMLElement,
  openLens: LensOpener,
  gone: () => boolean,
): Lane[] {
  const held: HeldElement[] = [];
  const heldEls: HTMLVideoElement[] = [];
  const lives = new Map<string, Lane>();
  for (const lane of current) {
    lane.els.forEach((el, e) => {
      held.push({ layer: lane.layer.id, src: lane.srcs[e] });
      heldEls.push(el);
    });
    if (lane.live) lives.set(lane.layer.id, lane);
  }
  const plan = planReuse(
    held,
    scene.layers.map((layer) => ({
      layer: layer.id,
      srcs: layer.clips.map((c) => c.src),
      count: elementCount(layer),
    })),
  );
  const lanes = scene.layers.map((layer, i): Lane => {
    if (layer.camera !== undefined) {
      const prev = lives.get(layer.id);
      if (prev?.live && prev.layer.camera === layer.camera) {
        lives.delete(layer.id);
        return { ...prev, layer };
      }
      const live: LiveLane = {
        el: liveElement(host),
        stream: null,
        problem: null,
      };
      void openCamera(
        layer.camera,
        live,
        openLens,
        () => gone() || !!live.dropped,
      );
      return { layer, els: [], srcs: [], loaded: [], settleUntil: [], live };
    }
    const slots = plan.lanes[i];
    return {
      layer,
      els: slots.map((j) => (j < 0 ? videoElement(host) : heldEls[j])),
      srcs: slots.map((j) => (j < 0 ? null : held[j].src)),
      // Clip indices mean nothing across an edit: the src an element holds is what the driver claims it by.
      loaded: slots.map(() => null),
      settleUntil: slots.map(() => 0),
    };
  });
  for (const j of plan.drop) releaseVideo(heldEls[j]);
  for (const lane of lives.values()) if (lane.live) closeLive(lane.live);
  return lanes;
}
