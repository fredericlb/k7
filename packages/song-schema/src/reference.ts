// reference.ts — a REFERENCE TRACK: a finished recording kept in the workspace to listen
// against, never part of any project. Where they live and what counts as one, with no
// `node:fs` so the file service and the browser go by the same rules. See
// docs/references.md.

/** The folder a workspace keeps them in, beside `_modules`, `_libraries` and `_playlists`. */
export const REFERENCES_DIR = "_references";

/** The extensions offered as reference tracks — what a browser's `<audio>` can be asked to decode. */
export const REFERENCE_EXTS = [
  ".wav",
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".aif",
  ".aiff",
  ".webm",
] as const;

/** …as one `accept` string, for the file picker that uploads into the folder. */
export const REFERENCE_ACCEPT = REFERENCE_EXTS.join(",");

/** Is this file name a reference track? The extension is the whole rule — there is no sidecar. */
export function isReferenceFile(name: string): boolean {
  const at = name.lastIndexOf(".");
  if (at <= 0) return false;
  const ext = name.slice(at).toLowerCase();
  return (REFERENCE_EXTS as readonly string[]).includes(ext);
}

/** What a row shows: the file name without its extension. */
export function referenceName(file: string): string {
  const at = file.lastIndexOf(".");
  return at > 0 ? file.slice(0, at) : file;
}

/** A reference track as a listing hands it over — `path` is workspace-relative, so it is already what `/media` takes. */
export interface ReferenceTrack {
  path: string;
  /** The file name without its extension, which is what a row reads as. */
  name: string;
  /** Bytes on disk, the one thing a listing can say about a file nobody has decoded yet. */
  bytes: number;
}

/** An uploaded file's workspace path, or null for a name that would leave the folder (docs/references.md). */
export function referencePathOf(name: string): string | null {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  const segs = clean.split(/[\\/]+/);
  if (segs.some((s) => !s || s === "." || s === "..")) return null;
  const rel = segs.join("/");
  return isReferenceFile(rel) ? `${REFERENCES_DIR}/${rel}` : null;
}
