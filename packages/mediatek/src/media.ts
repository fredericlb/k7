// media.ts — which extensions are audio and which are video. One list, because the scan
// decides what to LIST by it and the upload decides what to ACCEPT by it: a file the upload
// took and the scan does not recognise is a song the library cannot see.

const AUDIO_EXT = new Set([
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

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);

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
