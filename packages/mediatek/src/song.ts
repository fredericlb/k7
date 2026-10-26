// song.ts — where an uploaded audio file lands: `songs/<artiste>/<album>/<titre>/
// original.<ext>`, plus the sidecar that files it. Pure, so the dialogue that asks for the
// three fields can show the exact path the server will build. See docs/songs.md.

import { extOf, isAudio } from "./media.ts";

/** The master's name inside a song folder — fixed stem, and the extension follows the bytes. */
export const MASTER_STEM = "original";

/** What an absent field becomes — a folder naming the hole beats an upload refused over a tag. */
export const UNKNOWN_ARTIST = "Artiste inconnu";
export const UNKNOWN_ALBUM = "Album inconnu";
export const UNTITLED = "Sans titre";

/** Thrown for a file the scan would not recognise as audio — a 400, never a 500. */
export class NotAudioError extends Error {}

/** Thrown when the deduced folder already holds a master — a 409 to confirm, not to retry. */
export class SongExistsError extends Error {}

/** Thrown when a variant cannot be filed where it was aimed — both cases are 400s (docs/variants.md). */
export class VariantRefusedError extends Error {}

/** Thrown when a song's tags cannot be set as asked — no master, or a key in no known spelling; a 400. */
export class TagsRefusedError extends Error {}

export interface SongTags {
  artist?: string;
  album?: string;
  title?: string;
  /** Who filed it — `upload`, `k7` or `mirror`; its absence is what "nobody filed this" looks like. */
  source?: string;
}

/** One tag as one path segment, nameable on three operating systems — see docs/songs.md. */
export function segment(raw: string | undefined, fallback: string): string {
  const s = (raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Parentheses and apostrophes survive: they are legal everywhere, and "(Live)" is a version.
    .replace(/[^\w\s.()'&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    // Windows refuses a name ending in a dot or a space, silently, at rename time.
    .replace(/[. ]+$/, "");
  return s || fallback;
}

/** The folder a song with these tags belongs in — three segments below `songs/`, never four; docs/songs.md. */
export function songFolder(tags: SongTags): string {
  return [
    "songs",
    segment(tags.artist, UNKNOWN_ARTIST),
    segment(tags.album, UNKNOWN_ALBUM),
    segment(tags.title, UNTITLED),
  ].join("/");
}

/** The master's file name for an upload, or a refusal for something that is not audio. */
export function masterName(filename: string): string {
  if (!isAudio(filename))
    throw new NotAudioError(`${filename}: not an audio file`);
  return `${MASTER_STEM}${extOf(filename)}`;
}

/** The name the sidecar files an uploaded variant under — the file's own stem, made nameable (docs/variants.md). */
export function variantName(filename: string): string {
  const ext = extOf(filename);
  return segment(filename.slice(0, filename.length - ext.length), "variante");
}

/** …and the file it lands in beside the master, keeping the stem the sidecar's `ref` is matched against. */
export function variantFile(filename: string): string {
  if (!isAudio(filename))
    throw new NotAudioError(`${filename}: not an audio file`);
  return `${variantName(filename)}${extOf(filename)}`;
}

/** The sidecar, whose `source` tells a reader where the folder came from; title, artist and album are the master's tags. */
export function sidecarFor(source?: string): string {
  return `${[
    "# Title, artist, album, tempo and key live in the master's tags — see packages/mediatek/docs/songs.md.",
    `source: ${JSON.stringify(source || "upload")}`,
  ].join("\n")}\n`;
}

/** Artist and title GUESSED from a file name, for a file that carries no tags at all. */
export function tagsFromFilename(filename: string): SongTags {
  const stem = filename.slice(0, filename.length - extOf(filename).length);
  // A leading track number is filing, not part of anybody's name.
  const clean = stem.replace(/^\s*\d{1,3}\s*[-._)]?\s+/, "").trim();
  const parts = clean.split(/\s+-\s+/);
  if (parts.length >= 2)
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  return { title: clean || stem };
}
