// morceau.ts — where an uploaded audio file lands: `morceaux/imported/<artiste>/<album>/
// <titre>/original.<ext>`, plus the sidecar that files it. Pure, so the dialogue that asks
// for the three fields can show the exact path the server will build. See docs/upload.md.

import { extOf, isAudio } from "./media.ts";

/** The master's name inside a morceau folder. Fixed, so a consumer that has the folder can
 *  find the audio without a listing — the extension follows the bytes, never a re-encode. */
export const MASTER_STEM = "original";

/** Uploads are somebody else's master: `imported`, never `recorded`. See layout.ts. */
export const UPLOAD_KIND = "imported";

/** What an absent field becomes. A folder named for the hole is findable and renameable;
 *  refusing the upload over a missing album tag would not be. */
export const UNKNOWN_ARTIST = "Artiste inconnu";
export const UNKNOWN_ALBUM = "Album inconnu";
export const UNTITLED = "Sans titre";

/** Thrown for a file the scan would not recognise as audio — a 400, never a 500. */
export class NotAudioError extends Error {}

/** Thrown when the deduced folder already holds a master. A caller-fixable 409: the answer
 *  is to confirm the replacement, not to retry the same request. */
export class MorceauExistsError extends Error {}

export interface MorceauTags {
  artist?: string;
  album?: string;
  title?: string;
  /** Who filed it: `upload` from the médiathèque's own button, `k7` for a version
   *  pushed on publication, `mirror` for one pulled. Its ABSENCE, in a folder found on
   *  disk with no sidecar at all, is what "nobody filed this" looks like. */
  source?: string;
}

/**
 * One tag as one path segment.
 *
 * Everything that is not plainly nameable goes rather than being escaped: this becomes a
 * path on three operating systems, and it is also the id a cache keys its manifest by.
 * Accents are decomposed and dropped — "Café" becomes "Cafe" rather than "Caf", which is
 * what a bare non-word strip would have left. The real spelling survives in the sidecar.
 */
export function segment(raw: string | undefined, fallback: string): string {
  const s = (raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Parentheses and apostrophes survive: they are legal everywhere and they are what
    // makes "(Live)" read as a version rather than as part of the title.
    .replace(/[^\w\s.()'&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    // Windows refuses a name ending in a dot or a space, silently, at rename time.
    .replace(/[. ]+$/, "");
  return s || fallback;
}

/**
 * The folder a morceau with these tags belongs in, mediatek-relative.
 *
 * `kind` is the provenance level — `imported` for somebody else's master, `recorded` for
 * what this studio produced. It defaults to the upload's answer and is a parameter because
 * k7 pushes its published versions here, and those are `recorded` by definition.
 * Validated by the caller against MORCEAU_KINDS: this module stays free of `node:fs`, and
 * that list lives with the rest of the layout.
 */
export function morceauFolder(tags: MorceauTags, kind = UPLOAD_KIND): string {
  return [
    "morceaux",
    segment(kind, UPLOAD_KIND),
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

/** The sidecar. `source` is what tells a human reading the folder where it came from, the
 *  way a mirrored one says `k7`; its absence is what "found on disk" looks like. */
export function sidecarFor(tags: MorceauTags): string {
  return `${[
    "# L'arborescence est déduite de ces trois champs — la renommer ici ne déplace rien.",
    "# Voir packages/mediatek/docs/upload.md.",
    `title: ${JSON.stringify(tags.title || UNTITLED)}`,
    `artist: ${JSON.stringify(tags.artist || "")}`,
    `album: ${JSON.stringify(tags.album || "")}`,
    `source: ${tags.source || "upload"}`,
  ].join("\n")}\n`;
}

/**
 * Artist and title guessed from a file name, for a file that carries no tags at all.
 *
 * A guess, and named like one: "01 - Miles Davis - So What.mp3" is the convention half a
 * disk follows, and offering it pre-filled costs nothing when the other half only has to
 * clear the field.
 */
export function tagsFromFilename(filename: string): MorceauTags {
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
