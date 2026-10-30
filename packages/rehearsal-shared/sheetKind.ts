// What kind of file a song's sheet holds — a PDF, an image, or a MusicXML score Verovio draws.
// One definition for the backend's upload check, the Sheet tab and both exports.
// What reads wrong: a score is recognised by its EXTENSION, since browsers send these files as
// application/octet-stream or text/xml — ../score/docs/score.md.

export type SheetKind = "pdf" | "image" | "score";

const IMAGE_MIME = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/;

/** Score extensions and the media type each is stored and served under. */
const SCORE_MIME: Record<string, string> = {
  musicxml: "application/vnd.recordare.musicxml+xml",
  xml: "application/vnd.recordare.musicxml+xml",
  mxl: "application/vnd.recordare.musicxml",
};

/** What the file picker offers: everything this module accepts. */
export const SHEET_ACCEPT = [
  "application/pdf",
  "image/*",
  ...Object.keys(SCORE_MIME).map((ext) => `.${ext}`),
].join(",");

const extOf = (name: string): string =>
  /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";

/** The kind of sheet a file is, or null when a song's sheet does not take it. */
export function sheetKind(name: string, mime: string): SheetKind | null {
  if (mime === "application/pdf") return "pdf";
  if (IMAGE_MIME.test(mime)) return "image";
  if (extOf(name) in SCORE_MIME) return "score";
  if (Object.values(SCORE_MIME).includes(mime)) return "score";
  return null;
}

/** The media type a sheet is stored under — the score's own, whatever the browser sent — or null when refused. */
export function canonicalSheetMime(name: string, mime: string): string | null {
  const kind = sheetKind(name, mime);
  if (kind === null) return null;
  if (kind !== "score") return mime;
  return SCORE_MIME[extOf(name)] ?? mime;
}

/** The extension a cached copy is written under, which is what a reader sniffs the type from. */
export function sheetExt(name: string, mime: string): string {
  const kind = sheetKind(name, mime);
  if (kind === "pdf") return "pdf";
  if (kind === "image") {
    const sub = IMAGE_MIME.exec(mime)?.[1] ?? "bin";
    return sub === "svg+xml" ? "svg" : sub === "jpeg" ? "jpg" : sub;
  }
  if (kind === "score") {
    const ext = extOf(name);
    return ext in SCORE_MIME ? ext : "musicxml";
  }
  return "bin";
}

/** The type a sheet is SERVED under: a score is bytes for the viewer, never an XML type a browser would render. */
export function sheetServedMime(name: string, mime: string): string {
  const kind = sheetKind(name, mime);
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") return mime;
  return "application/octet-stream";
}

export const isScore = (sheet: { name: string; mime: string }): boolean =>
  sheetKind(sheet.name, sheet.mime) === "score";
