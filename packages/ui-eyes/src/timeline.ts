// timeline.ts — which clips a layer shows at time t, where in their sources, and the transition
// running between them. Pure and side-effect free (no WebGL, no DOM, no Date.now()), so it is
// unit-testable off a bare scene and shared verbatim: realtime calls it per rAF tick, export per
// frame. This is the ONLY place the transition rule lives. See song-video/docs/transitions.md.

import type { SceneClip, VideoLayer } from "./scene";

export interface Active {
  clip: SceneClip;
  // Where in the SOURCE file this maps to, in seconds: sourceFrom + (t - start).
  sourceTime: number;
  // Where this placement stops, by the interval rule below; Infinity for an open-ended last one.
  end: number;
  // Its position in `layer.clips` — the driver's element key, since a clip's id is its REF and repeats.
  index: number;
}

/** A shot inside its fade's STRETCH this frame: which run, and how present the shot is — 1 whole, 0 gone. */
export interface SlotStretch {
  chain: string;
  presence: number;
}

/** What a layer draws at `t`: up to two pictures, the program between them when a fade runs, and each one's stretch. */
export interface LayerFrame {
  from: Active | null; // the picture going OUT — null means the transparent texel
  to: Active | null; // …and the one coming IN
  // null == draw `to` plain, as a cut does
  blend: {
    name: string;
    progress: number;
    stretch?: { from?: SlotStretch; to?: SlotStretch };
  } | null;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Where the placement at `i` stops: its own length, else the NEXT entry's start, else open.
function endOf(clips: readonly SceneClip[], i: number): number {
  const c = clips[i];
  if (c.length > 0) return c.start + c.length;
  return i + 1 < clips.length ? clips[i + 1].start : Number.POSITIVE_INFINITY;
}

// Every clip active on `layer` at `t`, in FILE order. Half-open intervals; length 0 runs to the next start.
export function activesAt(layer: VideoLayer, t: number): Active[] {
  const clips = layer.clips;
  const out: Active[] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (t < c.start) continue;
    const end = endOf(clips, i);
    if (t < end)
      out.push({
        clip: c,
        sourceTime: c.sourceFrom + (t - c.start),
        end,
        index: i,
      });
  }
  // A lane has two decoders, so three at once is not renderable: the two on TOP win.
  return out.length > 2 ? out.slice(-2) : out;
}

/** The clip on TOP at `t`, or null — the LAST active in file order, which is the one covering the rest. */
// Last rather than first: a dissolve that completed would otherwise snap back to the outgoing shot.
export function activeAt(layer: VideoLayer, t: number): Active | null {
  const all = activesAt(layer, t);
  return all.length ? all[all.length - 1] : null;
}

/** Is a layer of SHAPES on at `t`? Its clips carry no picture: each is a span saying the lane is
 *  on, and a layer stating none is on throughout — see song-video/docs/shapes.md. Here beside
 *  `activesAt` because it IS that rule, and realtime and export must not each keep their own. */
export function shapesVisibleAt(layer: VideoLayer, t: number): boolean {
  return !layer.clips.length || !!activeAt(layer, t);
}

/** A shot inside its OWN fade-out's stretch at `t`, measured back from its end; undefined outside it. */
function leaving(a: Active, t: number): SlotStretch | undefined {
  const fade = a.clip.fadeOut;
  if (!fade?.chain || !Number.isFinite(a.end)) return undefined;
  const len = Math.min(fade.over, a.end - a.clip.start);
  const from = a.end - len;
  if (!(len > 0) || t < from) return undefined;
  return { chain: fade.chain, presence: 1 - clamp01((t - from) / len) };
}

// The stretch half of a blend, absent when neither side runs one — a blend without it is the plain case.
const stretchOf = (
  from: SlotStretch | undefined,
  to: SlotStretch | undefined,
) =>
  from || to
    ? { stretch: { ...(from ? { from } : {}), ...(to ? { to } : {}) } }
    : {};

/** The whole frame rule for one layer — which two pictures, how far between them, and which run through a stretch. */
export function layerFrameAt(layer: VideoLayer, t: number): LayerFrame {
  const all = activesAt(layer, t);
  if (!all.length) return { from: null, to: null, blend: null };
  const over = all[all.length - 1];
  const under = all.length > 1 ? all[all.length - 2] : null;
  // A fade is clamped to its own shot: a trim can leave one longer than what it runs over.
  const span = over.end - over.clip.start;

  const fadeIn = over.clip.fadeIn;
  if (fadeIn) {
    const len = Math.min(fadeIn.over, span);
    // `under` may be null, and that is a fade from NOTHING — the same branch, which is the point.
    if (len > 0 && t < over.clip.start + len) {
      const progress = clamp01((t - over.clip.start) / len);
      // The incoming shot governs the BLEND; the outgoing one still runs its own fade-out's stretch.
      const into = fadeIn.chain
        ? { chain: fadeIn.chain, presence: progress }
        : undefined;
      return {
        from: under,
        to: over,
        blend: {
          name: fadeIn.with,
          progress,
          ...stretchOf(under ? leaving(under, t) : undefined, into),
        },
      };
    }
  }

  const fadeOut = over.clip.fadeOut;
  // An open-ended shot has no end to measure back from; the schema refuses that pair, this survives it.
  if (fadeOut && Number.isFinite(over.end)) {
    const len = Math.min(fadeOut.over, span);
    const from = over.end - len;
    if (len > 0 && t >= from)
      return {
        from: over,
        to: null,
        blend: {
          name: fadeOut.with,
          progress: clamp01((t - from) / len),
          ...stretchOf(leaving(over, t), undefined),
        },
      };
  }

  return { from: null, to: over, blend: null };
}
