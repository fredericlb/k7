// export.ts — render the viewport frame-by-frame to an mp4, deterministically: the same
// compositor as realtime, but frame n maps to second n/fps and each source frame is
// pulled EXACTLY, so a song always yields the same picture. Video only — the song's sound
// is the engine's mix, married in later. WebCodecs-gated (effectively Chrome-only).

import {
  ALL_FORMATS,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
  VideoSampleSink,
} from "mediabunny";
import type { LayerBlend } from "./compositor";
import { Compositor } from "./compositor";
import type { VideoScene } from "./scene";
import { type Active, layerFrameAt } from "./timeline";

export interface ExportOptions {
  // Frames to emit, defaulting to duration × fps. A song ending on a natural-length clip has no known end, so pass one.
  frameCount?: number;
  // H.264 keyframe interval in seconds: frequent keyframes help seeking in the output, at the cost of size.
  keyIntervalSec?: number;
  bitrate?: number; // bits/s; omit for QUALITY_HIGH
}

export interface ExportProgress {
  frame: number;
  total: number;
}

// Render `scene` to an mp4 ArrayBuffer (video only), calling `onProgress` per frame. Throws if WebCodecs can't.
export async function exportScene(
  scene: VideoScene,
  opts: ExportOptions = {},
  onProgress?: (p: ExportProgress) => void,
): Promise<ArrayBuffer> {
  if (typeof VideoEncoder === "undefined")
    throw new Error(
      "eyes: video export needs WebCodecs (VideoEncoder), which this browser doesn't provide — use Chrome",
    );

  const [vw, vh] = scene.viewport;
  const fps = scene.fps;
  const total =
    opts.frameCount ?? Math.max(1, Math.round(scene.durationSec * fps));

  // Offscreen render target, shared by the compositor (writes) and the encoder (reads).
  const canvas = new OffscreenCanvas(vw, vh);
  const comp = Compositor.create(canvas, scene);

  // Open (Input, sink) lazily per distinct src and cache it, so a cut reuses a source and a shared clip decodes once.
  // Keyed by src AND SLOT: a shot dissolving into itself would otherwise ask one sink for two
  // timestamps a frame, and mediabunny's fast path needs them monotonically sorted — a decoder
  // flush per frame, silently, for the length of the fade.
  const cache = new Map<string, { input: Input; sink: VideoSampleSink }>();
  const sinkFor = async (src: string, slot: 0 | 1) => {
    const key = `${slot}:${src}`;
    let hit = cache.get(key);
    if (!hit) {
      const input = new Input({
        source: new UrlSource(src),
        formats: ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error(`eyes: ${src} has no video track to export`);
      hit = { input, sink: new VideoSampleSink(track) };
      cache.set(key, hit);
    }
    return hit.sink;
  };

  // Encoder + muxer: an mp4 into an in-memory buffer, one H.264 track fed from the canvas.
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const canvasSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: opts.bitrate ?? QUALITY_HIGH,
    ...(opts.keyIntervalSec ? { keyFrameInterval: opts.keyIntervalSec } : {}),
  });
  output.addVideoTrack(canvasSource);
  await output.start();

  try {
    for (let n = 0; n < total; n++) {
      const t = n / fps;
      const visible = new Set<string>();
      const blends = new Map<string, LayerBlend>();
      for (const layer of scene.layers) {
        if (layer.hidden) continue;
        // A shape layer has no media to sample: mark it visible and let draw() paint the fills the compositor holds.
        if (layer.shapes?.length) {
          visible.add(layer.id);
          continue;
        }
        const frame = layerFrameAt(layer, t);
        // Slot 0 is the outgoing picture and slot 1 the incoming one; a cut uses slot 0 alone.
        const wanted: { active: Active; slot: 0 | 1 }[] = frame.blend
          ? [
              ...(frame.from ? [{ active: frame.from, slot: 0 as const }] : []),
              ...(frame.to ? [{ active: frame.to, slot: 1 as const }] : []),
            ]
          : frame.to
            ? [{ active: frame.to, slot: 0 as const }]
            : [];
        let from = false;
        let to = false;
        for (const w of wanted) {
          const sink = await sinkFor(w.active.clip.src, w.slot);
          const sample = await sink.getSample(w.active.sourceTime);
          if (!sample) continue;
          try {
            // toCanvasImageSource() yields an OffscreenCanvas or VideoFrame — either uploads exactly like a <video>.
            comp.upload(layer.id, sample.toCanvasImageSource(), w.slot);
            if (w.slot === 0) from = true;
            else to = true;
          } finally {
            sample.close(); // a VideoSample holds GPU memory until closed — a leak here OOMs
          }
        }
        if (!from && !to) continue;
        visible.add(layer.id);
        if (frame.blend) blends.set(layer.id, { ...frame.blend, from, to });
      }
      comp.draw(visible, blends);
      // Encode the canvas as this frame; mediabunny bounds its own queue, so awaiting here is the backpressure.
      await canvasSource.add(t, 1 / fps);
      onProgress?.({ frame: n + 1, total });
    }
    await output.finalize();
  } finally {
    for (const { input } of cache.values()) input.dispose?.();
    comp.destroy();
  }

  if (!target.buffer) throw new Error("eyes: export produced no output");
  return target.buffer;
}
