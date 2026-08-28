// exportArgs.ts — what `project export` was asked for. Pure, because the command has two shapes
// now and the shell's handler is the wrong place to tell them apart.
//
//   project export audio wav|mp3        the mixdown, rendered by the engine
//   project export video mp4 [wav|mp3]  the frame, rendered here — and the sound married into it
//
// See ../docs/picture.md.

/** The mixdown formats the file service will render. */
export const MIX_FORMATS = ["wav", "mp3"] as const;
export type MixFormat = (typeof MIX_FORMATS)[number];

/** …and the container the picture leaves in. One so far: WebCodecs gives us H.264 in mp4. */
export const VIDEO_FORMATS = ["mp4"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/** What the audio track of an exported video is rendered from when the line names none. WAV: it
 *  is decoded and re-encoded into the container either way, so the lossy step buys nothing. */
export const DEFAULT_VIDEO_AUDIO: MixFormat = "wav";

export type ExportAsk =
  | { kind: "audio"; format: MixFormat }
  /** `audio` is absent only when the line asked for a silent film — `video mp4 none`. */
  | { kind: "video"; format: VideoFormat; audio: MixFormat | null };

const isMix = (s: string): s is MixFormat =>
  (MIX_FORMATS as readonly string[]).includes(s);
const isVideo = (s: string): s is VideoFormat =>
  (VIDEO_FORMATS as readonly string[]).includes(s);

/** The usage line, built from the vocabularies above so it cannot drift from them. */
export const EXPORT_USAGE = `usage: project export audio <${MIX_FORMATS.join("|")}> · project export video <${VIDEO_FORMATS.join("|")}> [<${MIX_FORMATS.join("|")}>|none]`;

/**
 * Read the rest of a `project export` line, or null when it says nothing this understands.
 *
 * The bare `project export wav` this replaced is deliberately NOT accepted: the word that follows
 * now says which half of the project leaves, and quietly reading an old line as audio would make
 * `project export mp4` mean the mixdown.
 */
export function parseExportAsk(rest: string): ExportAsk | null {
  const parts = rest.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [what, format, audio, ...extra] = parts;
  if (extra.length) return null;
  if (what === "audio")
    return !audio && isMix(format ?? "")
      ? { kind: "audio", format: format as MixFormat }
      : null;
  if (what !== "video" || !isVideo(format ?? "")) return null;
  const track =
    audio === undefined
      ? DEFAULT_VIDEO_AUDIO
      : audio === "none"
        ? null
        : isMix(audio)
          ? audio
          : undefined;
  return track === undefined
    ? null
    : { kind: "video", format: format as VideoFormat, audio: track };
}
