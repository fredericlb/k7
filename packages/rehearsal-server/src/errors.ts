// errors.ts — the JSON error handler every rehearsal router ends with: an error is answered as
// JSON, never as Express's HTML page with its stack.

import type express from "express";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
};

/** An upload past one of multer's limits is the client's: too big or too many is 413, a stray file field 400. */
function uploadStatus(err: HttpError): number | undefined {
  if (err.name !== "MulterError" && err.code !== "LIMIT_FILE_SIZE") return;
  return err.code === "LIMIT_UNEXPECTED_FILE" ? 400 : 413;
}

/** Answered as JSON, never Express's HTML page; an error-mode request that is not ours never reaches it. */
export function jsonErrors(
  err: HttpError,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  const status = err.status ?? err.statusCode ?? uploadStatus(err) ?? 500;
  // A 503 is a known, passing refusal (a full re-encode queue): said in words, retried later, not logged as a fault.
  const busy = status === 503;
  if (status >= 500 && !busy) console.error(err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (busy) res.setHeader("Retry-After", "5");
  res
    .status(status)
    .json({ error: status >= 500 && !busy ? "internal error" : err.message });
}
