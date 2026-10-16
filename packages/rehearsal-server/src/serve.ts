// serve.ts — every byte this package streams goes out through here, with a type the SERVER chose.
// What reads wrong: a stored mime is never trusted, since a client picked it — ../docs/serving.md.

import { streamFile } from "@frediverse/http";
import { extForMime, mimeFor } from "@studio/mediatek/media";
import { sheetServedMime } from "@studio/rehearsal-shared/sheetKind";
import type { Request, Response } from "express";

/** Whether an upload says it is audio; anything else is refused before it is stored. */
export const isAudioMime = (mime: string | undefined): boolean =>
  /^audio\//.test(String(mime ?? ""));

/** The audio type of a file, read off its extension with the médiathèque's table; bytes nobody can play otherwise. */
export function audioMimeOf(file: string): string {
  const mime = mimeFor(file);
  if (mime.startsWith("audio/")) return mime;
  // A recorder's mp4 or webm holds sound alone: served as audio, an `<audio>` plays it.
  if (mime === "video/mp4" || mime === "video/webm")
    return mime.replace("video/", "audio/");
  return "application/octet-stream";
}

/** The undotted extension audio of this type is filed under, or undefined when the type names none. */
export function audioExtOf(
  mime: string | null | undefined,
): string | undefined {
  return extForMime(String(mime ?? ""))?.slice(1);
}

/** Stream a recording, a clip, a version or a stem, under an audio type or none. */
export function streamAudio(
  req: Request,
  res: Response,
  filePath: string,
  mime: string,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  streamFile(
    req,
    res,
    filePath,
    isAudioMime(mime) ? mime : "application/octet-stream",
  );
}

// An SVG drawn by an <img> keeps working under this; opened as a page, it runs nothing.
const SHEET_CSP =
  "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'";

/** Stream a sheet file: a PDF as itself, an image sandboxed, a score as bytes for alphaTab. */
export function streamSheet(
  req: Request,
  res: Response,
  info: { filePath: string; name: string; mime: string },
): void {
  const type = sheetServedMime(info.name, info.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // A PDF viewer refuses a sandboxed document, and a browser's PDF viewer runs no script on this origin.
  if (type !== "application/pdf")
    res.setHeader("Content-Security-Policy", SHEET_CSP);
  streamFile(req, res, info.filePath, type);
}
