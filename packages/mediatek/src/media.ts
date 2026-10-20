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

/** The copy the library derives beside a FLAC for browsers — Opus in WebM — and the MP3 a volume may still hold from before. */
const DERIVED = ".webm";
const LEGACY = ".mp3";

/** The stream copy the library derives beside a FLAC, same stem, or null for anything else — docs/derived.md. */
export function derivedOf(name: string): string | null {
  return extOf(name) === ".flac"
    ? `${name.slice(0, -".flac".length)}${DERIVED}`
    : null;
}

/** Every name a FLAC's derived copy may have on a volume: today's, then the legacy MP3 the sweep removes. */
export function derivedNamesOf(name: string): string[] {
  if (extOf(name) !== ".flac") return [];
  const stem = name.slice(0, -".flac".length);
  return [`${stem}${DERIVED}`, `${stem}${LEGACY}`];
}

/** Is `name` a FLAC's derived copy, given every name in its folder? Such a file is never content. */
export function isDerived(name: string, siblings: readonly string[]): boolean {
  return derivedIn(new Set(siblings.map((s) => s.toLowerCase())), name);
}

/** The same test against an already-lowercased set of the folder's names. */
function derivedIn(lower: ReadonlySet<string>, name: string): boolean {
  const ext = extOf(name);
  return (
    (ext === DERIVED || ext === LEGACY) &&
    lower.has(`${name.slice(0, -ext.length)}.flac`.toLowerCase())
  );
}

/** A folder's listing with every derived copy taken out — the one filter every walk applies. */
export function withoutDerived<T extends { name: string }>(entries: T[]): T[] {
  if (!entries.some((e) => [DERIVED, LEGACY].includes(extOf(e.name))))
    return entries;
  const lower = new Set(entries.map((e) => e.name.toLowerCase()));
  return entries.filter((e) => !derivedIn(lower, e.name));
}

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

// The table read backwards, keyed by the type without its parameters: the FIRST extension listed for a type wins.
const EXT_BY_MIME = new Map<string, string>();
for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
  const base = mime.split(";")[0];
  if (!EXT_BY_MIME.has(base)) EXT_BY_MIME.set(base, ext);
}

// Audio types a browser or a client sends that the table spells another way.
const MIME_ALIASES: Record<string, string> = {
  "audio/mp3": ".mp3",
  "audio/m4a": ".m4a",
  "audio/aac": ".m4a",
  "audio/opus": ".opus",
  "audio/webm": ".webm",
};

/** The dotted extension a content type is filed under, its parameters and an `x-` ignored, or undefined — docs/mime.md. */
export function extForMime(mime: string): string | undefined {
  const base = mime.split(";")[0].trim().toLowerCase().replace("/x-", "/");
  return (
    MIME_ALIASES[base] ??
    EXT_BY_MIME.get(base) ??
    EXT_BY_MIME.get(base.replace("/", "/x-"))
  );
}

/** What to serve a path as, reading the LAST SEGMENT's extension so a dotted directory is not one. */
export function mimeFor(pathOrName: string): string {
  const last = pathOrName.split(/[\\/]/).pop() ?? "";
  return MIME_BY_EXT[extOf(last)] ?? "application/octet-stream";
}
