// errors.ts — the JSON error handler every rehearsal router ends with: an error is answered as
// JSON, never as Express's HTML page with its stack.

import type express from "express";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
};

/** Answered as JSON, never Express's HTML page; an error-mode request that is not ours never reaches it. */
export function jsonErrors(
  err: HttpError,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  const status =
    err.status ??
    err.statusCode ??
    (err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  if (status >= 500) console.error(err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res
    .status(status)
    .json({ error: status >= 500 ? "internal error" : err.message });
}
