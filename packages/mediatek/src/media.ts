// media.ts — which extensions are audio and which are video, and what content type each is
// served as. One list, because the scan decides what to LIST by it, the upload what to ACCEPT,
// and the two HTTP shells what to SEND: a file one of them disagrees about is a file the library
// takes and cannot then play. See docs/mime.md.

export const AUDIO_EXT = new Set([
  ".wav",
  ".flac",
  ".aiff",
  ".aif",
  ".mp3",
  ".ogg",
  ".opus",
  ".m4a",
  ".webm",
]);

export const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);

/** The extension, lowercased and with its dot, or "" for a name that has none. A leading
 *  dot is not an extension — ".gitignore" is a whole name. */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

export const isAudio = (name: string): boolean => AUDIO_EXT.has(extOf(name));
export const isVideo = (name: string): boolean => VIDEO_EXT.has(extOf(name));

/** For an `<input type="file">` accept attribute — the same list, in the browser's spelling. */
export const AUDIO_ACCEPT: string = [...AUDIO_EXT].join(",");

/**
 * Enough of a content type for a browser to play, show or download what the library holds.
 * `<audio>`/`<video>` need the family right; the rest can be a stream, since nothing here is
 * rendered as a document.
 *
 * DOTTED KEYS, matching `extOf` above and the two sets beside it. The two HTTP shells each had
 * their own table and the shapes drifted apart — one keyed with the dot, one without — so an
 * AIFF from the cache and a cover from the hosted volume both went out as octet-stream. One
 * table, one convention, and media.test.ts pins both. See docs/mime.md.
 */
export const MIME_BY_EXT: Record<string, string> = {
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".json": "application/json",
  ".nam": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * What to serve a path as. Reads the LAST SEGMENT's extension, so a directory carrying a dot
 * (`modules/v1.2/patch`) is not mistaken for one — which the cache shell's `split(".").pop()`
 * used to do. Octet-stream for anything unlisted: honest, and the browser downloads it.
 */
export function mimeFor(pathOrName: string): string {
  const last = pathOrName.split(/[\\/]/).pop() ?? "";
  return MIME_BY_EXT[extOf(last)] ?? "application/octet-stream";
}
