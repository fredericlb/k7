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

/** The extension, lowercased and with its dot, or "" — a leading dot is a whole name, not one. */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

export const isAudio = (name: string): boolean => AUDIO_EXT.has(extOf(name));
export const isVideo = (name: string): boolean => VIDEO_EXT.has(extOf(name));

/** For an `<input type="file">` accept attribute — the same list, in the browser's spelling. */
export const AUDIO_ACCEPT: string = [...AUDIO_EXT].join(",");

/** Enough content type for a browser to play or show what the library holds, DOTTED keys — docs/mime.md. */
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

/** What to serve a path as, reading the LAST SEGMENT's extension so a dotted directory is not one. */
export function mimeFor(pathOrName: string): string {
  const last = pathOrName.split(/[\\/]/).pop() ?? "";
  return MIME_BY_EXT[extOf(last)] ?? "application/octet-stream";
}
