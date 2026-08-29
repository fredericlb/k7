// exportSupport.ts — can this build actually encode the mp4 `export.ts` asks for?
//
// `"VideoEncoder" in window` answers the wrong question. It is true in every Chromium, and in
// ELECTRON it is always true — but WebCodecs having the class says nothing about the platform
// encoder behind it. A build without H.264 fails at frame 0, after the progress bar has drawn,
// with a NotSupportedError that names no cause. See docs/passes.md.

/** Why an export cannot run, in the words the user needs rather than the API's. */
export type ExportSupport =
  | { ok: true }
  | {
      ok: false;
      reason: "no-webcodecs" | "no-h264" | "no-aac";
      detail: string;
    };

/**
 * H.264 profiles to try, easiest first. Any ONE of them is enough: a false negative here would
 * hide an export that works, which is worse than the failure this file exists to catch.
 */
const H264 = ["avc1.42001f", "avc1.4d0028", "avc1.640028"];
/** AAC-LC, which is what `export.ts` asks mediabunny for as `codec: "aac"`. */
const AAC = "mp4a.40.2";

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
 * Ask the encoders, at the size the scene will use. `withAudio` is false for a silent film,
 * where AAC is not needed and its absence must not stop the export.
 */
export async function probeExportSupport(
  width: number,
  height: number,
  withAudio = true,
  encoders: Encoders = globals(),
): Promise<ExportSupport> {
  if (!encoders.video) {
    return {
      ok: false,
      reason: "no-webcodecs",
      detail: "this build has no WebCodecs, so it cannot render a video export",
    };
  }

  let anyH264 = false;
  for (const codec of H264) {
    if (
      await supported(encoders.video, { codec, width, height, bitrate: 8e6 })
    ) {
      anyH264 = true;
      break;
    }
  }
  if (!anyH264) {
    return {
      ok: false,
      reason: "no-h264",
      detail:
        "this build cannot encode H.264, so an mp4 export would produce no video track",
    };
  }

  if (withAudio && encoders.audio) {
    const ok = await supported(encoders.audio, {
      codec: AAC,
      sampleRate: 48000,
      numberOfChannels: 2,
    });
    if (!ok) {
      return {
        ok: false,
        reason: "no-aac",
        detail:
          "this build cannot encode AAC, so the export would come out silent",
      };
    }
  }

  return { ok: true };
}
