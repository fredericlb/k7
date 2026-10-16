// webTracks.ts — a compiled song's lanes as the BROWSER reads them: the flat WebTrack[] the timeline
// draws, and the picture lanes with every media path made workspace-relative. Pure shaping, no I/O
// beyond a source's length. See docs/workspace.md.

import { statSync } from "node:fs";
import { basename } from "node:path";
import { isFrozenClipId } from "@studio/song/nodeProject";
import type { TrackDoc } from "@studio/song/project";
import { trackMixer } from "@studio/song/project";
import type { VideoTrackDoc } from "@studio/song-video/videoDoc";
import { wavSeconds } from "@studio/take-render/wavLength";
import type { WebMixer, WebTrack, WebVideoTrack } from "@studio/web-protocol";
import { foldComps } from "./webComp.ts";

// The strip a track's surfaces read — level and pan only, spread in. See docs/workspace.md.
function mixerOf(t: TrackDoc): { mixer?: WebMixer } {
  const p = trackMixer(t);
  if (!p) return {};
  const v = (name: string) => Number(p.params?.[name] ?? 0);
  return { mixer: { module: p.name, volume: v("Volume"), pan: v("Pan") } };
}

/** How long a source is, memoised on the file's IDENTITY rather than its name — docs/workspace.md. */
const durations = new Map<string, { key: string; secs: number | null }>();
function sourceSeconds(abs: string): number | null {
  let key: string;
  try {
    const s = statSync(abs);
    key = `${s.size}-${s.mtimeMs}`;
  } catch {
    return null; // gone, or never there — the caller draws what the document says
  }
  const hit = durations.get(abs);
  if (hit && hit.key === key) return hit.secs;
  const secs = wavSeconds(abs);
  durations.set(abs, { key, secs });
  return secs;
}

/** The extent a clip DRAWS at, for one whose document states none — see docs/workspace.md. */
function naturalBeats(c: TrackDoc["clips"][number], tempo: number): number {
  if (c.type !== "audio" || !c.source || tempo <= 0) return 0;
  const secs = sourceSeconds(c.source);
  if (secs === null) return 0;
  const rest = secs - (c.sourceFrom ?? 0);
  return rest > 0 ? (rest * tempo) / 60 : 0;
}

// One clip as the browser reads it, named so a TAKE draws identically to the arrangement it was.
function toWebClip(
  c: TrackDoc["clips"][number],
  // The extent to draw when the document states none — absent for a lane with no files behind it.
  natural?: (c: TrackDoc["clips"][number]) => number,
) {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    start: c.start,
    // `|| natural`, not `??`: 0 is precisely the value that means "unstated" — docs/workspace.md.
    length: c.length || natural?.(c) || 0,
    // The window of material this placement draws — what the browser's envelope cache keys on.
    offset: c.offset,
    sourceFrom: c.sourceFrom,
    sourceTo: c.sourceTo,
    // The NAME only: a browser has no business resolving a path on the engine's machine.
    sourceName: c.source ? basename(c.source) : undefined,
    loopStart: c.loopStart,
    loopEnd: c.loopEnd,
    // `warped` is "there is a map at play here"; `warpOff` is what draws the icon CROSSED.
    warped: c.warp || c.warpOff ? true : undefined,
    warpOff: c.warpOff ? true : undefined,
    disabled: c.disabled ? true : undefined,
    // The fades, `|| undefined` rather than copied: a zero fade is no fade — docs/workspace.md.
    fadeIn: c.fadeIn || undefined,
    fadeOut: c.fadeOut || undefined,
    // A render standing in for a frozen lane, told by the suffix the compiler reserves for one.
    frozen: isFrozenClipId(c.id) ? true : undefined,
    // The placement's own words, straight through — the only part a paste can write back.
    event: c.event,
    // …and, for a piece of a comped event, which event and which take (song docs/takes.md).
    ...(c.comp ? { comp: c.comp } : {}),
    ...(c.crossfade ? { crossfade: c.crossfade } : {}),
    notes: c.notes.map((n) => ({
      time: n.time,
      duration: n.duration,
      key: n.key,
      // Only when the file SAID one: the compiler defaults `vel` to 1 — see docs/workspace.md.
      ...(n.vel !== undefined && n.vel !== 1 ? { vel: n.vel } : {}),
      // The pad's effects, unexpanded — what the sequencer draws its icon from.
      ...(n.repeat ? { repeat: n.repeat } : {}),
      ...(n.skip ? { skip: n.skip } : {}),
    })),
  };
}

/** TrackDoc[] -> the flat WebTrack[] the Timeline draws; `tempo` turns seconds into beats. */
export function toWebTracks(tracks: TrackDoc[], tempo?: number): WebTrack[] {
  const natural =
    tempo === undefined
      ? undefined
      : (c: TrackDoc["clips"][number]) => naturalBeats(c, tempo);
  return tracks.map((t) => ({
    id: t.id,
    name: t.name,
    group: t.group,
    generated: t.generated,
    contentType: t.contentType,
    color: t.color,
    ...mixerOf(t),
    mute: t.mute,
    solo: t.solo,
    ...(t.highlight ? { highlight: true } : {}),
    // A comped event is ONE clip to every surface, its pieces carried inside it (webComp.ts).
    clips: foldComps(t.clips.map((c) => toWebClip(c, natural))),
    ...(t.frozenMaterial?.length
      ? { frozenMaterial: t.frozenMaterial.map((c) => toWebClip(c, natural)) }
      : {}),
    plugins: t.plugins.map((pl) => ({
      id: pl.id,
      type: pl.type,
      name: pl.name,
      ...(pl.sfzFile ? { sfzFile: pl.sfzFile } : {}),
    })),
    // `docs`/`todos`, `frozen` and the alternatives belong to the graph — packages/song/docs/docModules.md.
  }));
}

/** A song's picture lanes as the browser reads them, every media path made workspace-relative. */
export function toWebVideoTracks(
  videoTracks: VideoTrackDoc[],
  toRel: (abs: string) => string,
): WebVideoTrack[] {
  return videoTracks.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    mute: t.mute,
    solo: t.solo,
    // The LENS wired to this lane, when one is, and when it opens — packages/song/docs/camera.md.
    ...(t.camera === undefined
      ? {}
      : { camera: t.camera, cameraMonitor: t.cameraMonitor ?? "on" }),
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    // Workspace-RELATIVE on the way out: the browser fetches every byte back through /media.
    clips: t.clips.map((c) => ({
      id: c.id,
      name: c.name,
      src: c.source ? toRel(c.source) : "",
      ...(c.optimized ? { optimized: toRel(c.optimized) } : {}),
      ...(c.proxy ? { proxy: toRel(c.proxy) } : {}),
      ...(c.still ? { still: true as const } : {}),
      start: c.start,
      length: c.length,
      sourceFrom: c.sourceFrom,
      // A fade names its kind; the kind's GLSL rides on the project, once per name.
      ...(c.fadeIn ? { fadeIn: { ...c.fadeIn } } : {}),
      ...(c.fadeOut ? { fadeOut: { ...c.fadeOut } } : {}),
      ...(c.animate ? { animate: c.animate } : {}),
      ...(c.speed !== undefined ? { speed: c.speed } : {}),
      ...(c.effect ? { effect: c.effect } : {}),
      ...(c.captions ? { captions: c.captions } : {}),
    })),
    // Shapes carry no media path — each variant's fields, `id` included, pass straight through.
    shapes: t.shapes.map((s) => ({ ...s })),
    // …and this lane's own video run — a shader's GLSL travels INLINE, so there is no path here.
    ...(t.plugins?.length
      ? { plugins: t.plugins.map((p) => webPlugin(p, toRel)) }
      : {}),
  }));
}

/** A picture plugin for the browser: its LUT made workspace-relative, as every path the browser fetches back is. */
export function webPlugin<P extends { lut?: string }>(
  p: P,
  toRel: (abs: string) => string,
): P {
  return { ...p, ...(p.lut ? { lut: toRel(p.lut) } : {}) };
}
