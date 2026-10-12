// export.ts — render the viewport frame-by-frame to a video file, deterministically: the same
// compositor as realtime, but frame n maps to second n/fps and each source frame is
// pulled EXACTLY, so a song always yields the same picture. The song's SOUND is the engine's
// mix and is handed in decoded — see `ExportOptions.audio`. The codecs are the ones
// `exportSupport.ts` blessed, rather than ones inferred from WebCodecs being present.

import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
  VideoSampleSink,
  WebMOutputFormat,
} from "mediabunny";
import type { LayerBlend } from "./compositor";
import { Compositor } from "./compositor";
import { type ExportFormat, probeExportSupport } from "./exportSupport";

export {
  DEFAULT_VIDEO_FORMAT,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportSupport,
  probeExportSupport,
  VIDEO_FORMATS,
  type VideoFormat,
} from "./exportSupport";

import type { VideoScene } from "./scene";
import { type Active, layerFrameAt, shapesVisibleAt } from "./timeline";

export interface ExportOptions {
  /**
   * The container, and with it the codecs. WebM (VP9 + Opus) by default: it is the one pair every
   * build encodes, mp4 needing an H.264 and an AAC encoder no open-source build ships.
   */
  format?: ExportFormat;
  // Frames to emit, defaulting to duration × fps. A song ending on a natural-length clip has no known end, so pass one.
  frameCount?: number;
  // Keyframe interval in seconds: frequent keyframes help seeking in the output, at the cost of size.
  keyIntervalSec?: number;
  bitrate?: number; // bits/s; omit for QUALITY_HIGH
  /**
   * The song's sound, DECODED, to marry into the container. Absent makes a silent film.
   *
   * An AudioBuffer rather than the mixdown's bytes: the engine renders a wav or an mp3 and the
   * container wants neither, so it would be decoded here anyway — and taking it decoded keeps
   * every format question on the caller's side of this seam.
   */
  audio?: AudioBuffer;
}

export interface ExportProgress {
  frame: number;
  total: number;
}

/** The rendered file, with the two strings a caller needs to name it — both the container's own. */
export interface ExportResult {
  buffer: ArrayBuffer;
  mimeType: string;
  /** Leading dot, as mediabunny spells it: `.webm`. */
  extension: string;
}

// Render `scene` to a video file, calling `onProgress` per frame. Throws if this build cannot encode it.
export async function exportScene(
  scene: VideoScene,
  opts: ExportOptions = {},
  onProgress?: (p: ExportProgress) => void,
): Promise<ExportResult> {
  const [vw, vh] = scene.viewport;
  const format = opts.format ?? "webm";
  // ASKED, not assumed: `"VideoEncoder" in window` is true in every Chromium and always true
  // in Electron, and says nothing about the platform encoder behind it. Without this the
  // failure is a NotSupportedError at frame 0, after the progress bar has drawn.
  const can = await probeExportSupport(
    format,
    vw,
    vh,
    opts.audio !== undefined,
  );
  if (!can.ok) throw new Error(`eyes: ${can.detail}`);
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

  // Encoder + muxer: the container into an in-memory buffer, one video track fed from the canvas.
  const target = new BufferTarget();
  const container =
    format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({ format: container, target });
  const canvasSource = new CanvasSource(canvas, {
    codec: can.video,
    bitrate: opts.bitrate ?? QUALITY_HIGH,
    ...(opts.keyIntervalSec ? { keyFrameInterval: opts.keyIntervalSec } : {}),
  });
  output.addVideoTrack(canvasSource);
  // The sound, when there is any. Added BEFORE `start()`: an output's tracks are declared once.
  const audioSource =
    opts.audio && can.audio
      ? new AudioBufferSource({ codec: can.audio, bitrate: QUALITY_HIGH })
      : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  // …and fed in one go: an AudioBuffer is the whole song, and the muxer interleaves it against
  // the frames itself. Awaited here rather than at the end so a failure lands before the render.
  if (audioSource && opts.audio) await audioSource.add(opts.audio);

  try {
    for (let n = 0; n < total; n++) {
      const t = n / fps;
      const visible = new Set<string>();
      const blends = new Map<string, LayerBlend>();
      for (const layer of scene.layers) {
        if (layer.hidden) continue;
        // A shape layer has no media to sample: its ACTIVATION spans say when it is on, and draw()
        // paints the fills the compositor holds — the same rule realtime runs (docs/shapes.md).
        if (layer.shapes?.length) {
          if (shapesVisibleAt(layer, t)) visible.add(layer.id);
          continue;
        }
        // A LIVE lane is skipped, and that is the honest answer rather than a limitation to fix:
        // an export walks a timeline frame by frame, faster or slower than real time, and a lens
        // has no frame at t. What it would record is "whatever the camera happened to show while
        // the encoder ran", which is not the picture anybody asked for. See docs/camera.md.
        if (layer.camera !== undefined) continue;
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
  return {
    buffer: target.buffer,
    mimeType: container.mimeType,
    extension: container.fileExtension,
  };
}
