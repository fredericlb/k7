// upload.ts — a raw request body streamed to a file beside where it will land, never into memory:
// a 512 MB body held as a Buffer is 512 MB of heap per request in flight (../../docs/media/audit.md).
// The one thing a reader would get wrong: the route CONSUMES the file (mediatek's putFile moves it);
// whatever is still there when the response closes is removed, a refusal and a hang-up included.

import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mediatekDir } from "@studio/mediatek/layout";
import type { Request, RequestHandler } from "express";

/** The ceiling every upload route here had as `express.raw`'s limit. */
const MAX_UPLOAD = 512 * 1024 * 1024;

/** A dot-directory on the library volume, so no family scan sees it and a move into place is a rename. */
export const libraryUploads = (): string => join(mediatekDir(), ".uploads");

export interface Uploaded {
  file: string;
  size: number;
}

/** What `rawToDisk` left on the request — only ever read behind it. */
export const uploadOf = (req: Request): Uploaded =>
  (req as { upload?: Uploaded }).upload as Uploaded;

const tooLarge = (max: number) =>
  Object.assign(new Error(`upload over ${max} bytes`), { status: 413 });

/** Stream the body into `dir()`, counting it against `max`, and hand on its path as `uploadOf(req)`. */
export function rawToDisk(
  dir: () => string = libraryUploads,
  max: number = MAX_UPLOAD,
): RequestHandler {
  return (req, res, next) => {
    if (Number(req.headers["content-length"]) > max) return next(tooLarge(max));
    // The app-wide JSON parser got here first: its body is an object now, and the stream is spent.
    if ((req as { _body?: boolean })._body || req.readableEnded)
      return res
        .status(415)
        .json({ error: "send the bytes as application/octet-stream" });
    const at = dir();
    mkdirSync(at, { recursive: true });
    const file = join(at, `tmp-upload-${randomUUID()}`);
    res.on("close", () => rmSync(file, { force: true }));
    let size = 0;
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        if (size > max) done(tooLarge(max));
        else done(null, chunk);
      },
    });
    pipeline(req, count, createWriteStream(file)).then(
      () => {
        (req as { upload?: Uploaded }).upload = { file, size };
        next();
      },
      (e: Error) => next(e),
    );
  };
}

/** At boot nothing is in flight, so every temp file in `dir` is a crash's leftover. */
export function clearUploads(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
