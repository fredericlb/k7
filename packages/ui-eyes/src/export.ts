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
import { Compositor } from "./compositor";
import type { VideoScene } from "./scene";
import { activeAt } from "./timeline";

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
  const cache = new Map<string, { input: Input; sink: VideoSampleSink }>();
  const sinkFor = async (src: string) => {
    let hit = cache.get(src);
    if (!hit) {
      const input = new Input({
        source: new UrlSource(src),
        formats: ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error(`eyes: ${src} has no video track to export`);
      hit = { input, sink: new VideoSampleSink(track) };
      cache.set(src, hit);
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
      for (const layer of scene.layers) {
        if (layer.hidden) continue;
        // A shape layer has no media to sample: mark it visible and let draw() paint the fills the compositor holds.
        if (layer.shapes?.length) {
          visible.add(layer.id);
          continue;
        }
        const hit = activeAt(layer, t);
        if (!hit) continue;
        const sink = await sinkFor(hit.clip.src);
        const sample = await sink.getSample(hit.sourceTime);
        if (!sample) continue;
        try {
          // toCanvasImageSource() yields an OffscreenCanvas or VideoFrame — either uploads exactly like a <video>.
          comp.upload(layer.id, sample.toCanvasImageSource());
          visible.add(layer.id);
        } finally {
          sample.close(); // a VideoSample holds GPU memory until closed — a leak here OOMs
        }
      }
      comp.draw(visible);
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
