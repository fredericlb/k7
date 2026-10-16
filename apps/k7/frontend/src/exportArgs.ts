// exportArgs.ts — what `project export` was asked for. Pure, because the command has two shapes
// now and the shell's handler is the wrong place to tell them apart.
//
//   project export audio wav|mp3             the mixdown, rendered by the engine
//   project export video webm|mp4 [wav|mp3] [size= quality= from= to=]  the frame, rendered here
//   project export timeline otio|edl [lane]  the CUT, for another editor to open
//
// See ../docs/picture.md.

import { EXPORT_QUALITIES } from "@studio/ui-eyes/exportQuality";
import { VIDEO_FORMATS, type VideoFormat } from "@studio/ui-eyes/exportSupport";
import {
  parseVideoSettings,
  type VideoSettings,
} from "@studio/ui-eyes/renderSettings";

/** The mixdown formats the file service will render. */
export const MIX_FORMATS = ["wav", "mp3"] as const;
export type MixFormat = (typeof MIX_FORMATS)[number];

// The picture's containers live beside the probe that blesses them (@studio/ui-eyes/exportSupport), which loads no muxer;
// re-exported so the export command's vocabulary stays spelled in one place.
export {
  DEFAULT_VIDEO_FORMAT,
  VIDEO_FORMATS,
  type VideoFormat,
} from "@studio/ui-eyes/exportSupport";

/** What the audio track of an exported video is rendered from when the line names none. WAV: it
 *  is decoded and re-encoded into the container either way, so the lossy step buys nothing. */
export const DEFAULT_VIDEO_AUDIO: MixFormat = "wav";

/** The cut handed to another editor: OpenTimelineIO, or a CMX 3600 EDL of one lane (song-video docs/interchange.md). */
export const TIMELINE_FORMATS = ["otio", "edl"] as const;
export type TimelineFormat = (typeof TIMELINE_FORMATS)[number];

export type ExportAsk =
  | { kind: "audio"; format: MixFormat }
  /** `audio` is absent only when the line asked for a silent film — `video webm none`. */
  | {
      kind: "video";
      format: VideoFormat;
      audio: MixFormat | null;
      settings: VideoSettings;
    }
  | { kind: "timeline"; format: TimelineFormat; lane?: string };

const isMix = (s: string): s is MixFormat =>
  (MIX_FORMATS as readonly string[]).includes(s);
const isVideo = (s: string): s is VideoFormat =>
  (VIDEO_FORMATS as readonly string[]).includes(s);

/** The usage line, built from the vocabularies above so it cannot drift from them. */
export const EXPORT_USAGE = `project export audio <${MIX_FORMATS.join("|")}> · project export video <${VIDEO_FORMATS.join("|")}> [<${MIX_FORMATS.join("|")}>|none] [size=720p|1280x720] [quality=${EXPORT_QUALITIES.join("|")}] [from=<t>] [to=<t>] · project export timeline <${TIMELINE_FORMATS.join("|")}> [lane]`;

/**
 * Read the rest of a `project export` line, or null when it says nothing this understands.
 *
 * The bare `project export wav` this replaced is deliberately NOT accepted: the word that follows
 * now says which half of the project leaves, and quietly reading an old line as audio would make
 * `project export webm` mean the mixdown.
 */
export function parseExportAsk(rest: string): ExportAsk | null {
  const raw = rest.trim().split(/\s+/).filter(Boolean);
  const parts = raw.map((p, i) => (i < 2 ? p.toLowerCase() : p));
  const [what, format, ...tail] = parts;
  if (what === "audio")
    return !tail.length && isMix(format ?? "")
      ? { kind: "audio", format: format as MixFormat }
      : null;
  if (what === "timeline") {
    if (
      !(TIMELINE_FORMATS as readonly string[]).includes(format ?? "") ||
      tail.length > 1
    )
      return null;
    return {
      kind: "timeline",
      format: format as TimelineFormat,
      ...(tail[0] ? { lane: tail[0] } : {}),
    };
  }
  if (what !== "video" || !isVideo(format ?? "")) return null;
  // The sound word, when there is one, comes first; every word after it is a `key=value`.
  const first = tail[0]?.toLowerCase();
  const named = first !== undefined && !first.includes("=");
  const track = !named
    ? DEFAULT_VIDEO_AUDIO
    : first === "none"
      ? null
      : isMix(first)
        ? first
        : undefined;
  if (track === undefined) return null;
  const settings = parseVideoSettings(tail.slice(named ? 1 : 0));
  if (!settings) return null;
  return {
    kind: "video",
    format: format as VideoFormat,
    audio: track,
    settings,
  };
}

export type { VideoSettings } from "@studio/ui-eyes/renderSettings";
