// exportSupport.ts — can this build encode the container `export.ts` is about to write?
//
// `"VideoEncoder" in window` answers the wrong question. It is true in every Chromium, and in
// ELECTRON it is always true — but WebCodecs having the class says nothing about the platform
// encoder behind it. A build without the codec fails at frame 0, after the progress bar has
// drawn, with a NotSupportedError that names no cause. The answer carries the codec names the
// encoder is then handed, so the probe and the encoder cannot disagree. See docs/passes.md.

import type { AudioCodec, VideoCodec } from "mediabunny";

/** The containers an export leaves in, the default first — see docs/passes.md. */
export const EXPORT_FORMATS = ["webm", "mp4"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Either the codecs to encode with, or why this build cannot — in the user's words, not the API's. */
export type ExportSupport =
  | { ok: true; video: VideoCodec; audio?: AudioCodec }
  | {
      ok: false;
      reason: "no-webcodecs" | "no-video-codec" | "no-audio-codec";
      detail: string;
    };

/**
 * Per container: the encoder configs to try, easiest first, each carrying the name mediabunny is
 * given when it passes. Any ONE video entry is enough — a false negative here would hide an
 * export that works, which is worse than the failure this file exists to catch.
 */
const CONTAINERS: Record<
  ExportFormat,
  {
    video: { codec: VideoCodec; config: string }[];
    audio: { codec: AudioCodec; config: string };
    names: { video: string; audio: string };
  }
> = {
  webm: {
    video: [
      { codec: "vp9", config: "vp09.00.10.08" },
      { codec: "vp8", config: "vp8" },
    ],
    audio: { codec: "opus", config: "opus" },
    names: { video: "VP9 or VP8", audio: "Opus" },
  },
  mp4: {
    video: [
      { codec: "avc", config: "avc1.42001f" },
      { codec: "avc", config: "avc1.4d0028" },
      { codec: "avc", config: "avc1.640028" },
    ],
    audio: { codec: "aac", config: "mp4a.40.2" },
    names: { video: "H.264", audio: "AAC" },
  },
};

interface Encoders {
  video?: { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> };
  audio?: { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> };
}

/** The globals, unless a caller hands its own in — which is the only way this is testable off a browser. */
function globals(): Encoders {
  const g = globalThis as unknown as Encoders & {
    VideoEncoder?: Encoders["video"];
    AudioEncoder?: Encoders["audio"];
  };
  return { video: g.VideoEncoder, audio: g.AudioEncoder };
}

const supported = async (
  enc: Encoders["video"],
  config: unknown,
): Promise<boolean> => {
  try {
    return (await enc?.isConfigSupported(config))?.supported === true;
  } catch {
    // A config the implementation refuses to even parse is a no, not a crash.
    return false;
  }
};

/**
 * Ask the encoders, for one container, at the size the scene will use. `withAudio` is false for a
 * silent film, where the sound codec is not needed and its absence must not stop the export.
 */
export async function probeExportSupport(
  format: ExportFormat,
  width: number,
  height: number,
  withAudio = true,
  encoders: Encoders = globals(),
): Promise<ExportSupport> {
  const { video, audio, names } = CONTAINERS[format];
  if (!encoders.video) {
    return {
      ok: false,
      reason: "no-webcodecs",
      detail: "this build has no WebCodecs, so it cannot render a video export",
    };
  }

  let picture: VideoCodec | null = null;
  for (const c of video) {
    if (
      await supported(encoders.video, {
        codec: c.config,
        width,
        height,
        bitrate: 8e6,
      })
    ) {
      picture = c.codec;
      break;
    }
  }
  if (!picture) {
    return {
      ok: false,
      reason: "no-video-codec",
      detail: `this build cannot encode ${names.video}, so it cannot render a ${format} export`,
    };
  }

  // No AudioEncoder at all is the same answer as one that refuses the codec: the sound cannot go in.
  if (withAudio) {
    const ok = await supported(encoders.audio, {
      codec: audio.config,
      sampleRate: 48000,
      numberOfChannels: 2,
    });
    if (!ok) {
      return {
        ok: false,
        reason: "no-audio-codec",
        detail: `this build cannot encode ${names.audio}, so a ${format} export cannot carry the sound`,
      };
    }
  }

  return {
    ok: true,
    video: picture,
    ...(withAudio ? { audio: audio.codec } : {}),
  };
}
