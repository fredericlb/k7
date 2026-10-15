// hardening.ts — the response headers every answer carries, the framing rule for the SPA shell,
// and the last error handler, which never tells a client what a 5xx was (../docs/hardening.md).
// No script-src policy: panel scripts and an engine's ws address are not known ahead of time.

import { STATUS_CODES } from "node:http";
import type { NextFunction, Request, Response } from "express";

/** Every response: no MIME sniffing, and a referrer that leaves the origin as the origin only. */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Set before any route runs, so a route that wants another policy simply overwrites it.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}

/** The SPA shell may be framed by its own origin only — the rehearsal recorder frames the bench. */
export function shellFrameHeaders(res: Response): void {
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
}

type HttpError = Error & {
  type?: string;
  code?: string;
  status?: number;
  statusCode?: number;
  expose?: boolean;
};

/** What a client is told: a 4xx keeps its message unless marked unexposed, a 5xx is only "internal error". */
export function errorBody(err: HttpError): { status: number; error: string } {
  const raw = err.status ?? err.statusCode ?? 500;
  const status = raw >= 400 && raw < 600 ? raw : 500;
  if (status >= 500) return { status, error: "internal error" };
  // `send` marks a missing file `expose: false`, since its message is a server path.
  if (err.expose === false || !err.message)
    return { status, error: (STATUS_CODES[status] ?? "error").toLowerCase() };
  return { status, error: err.message };
}

/** Mounted LAST; a caller hanging up mid-upload is an everyday event, logged as a warning. */
export function jsonErrorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const gone =
    err.type === "request.aborted" ||
    err.code === "ECONNABORTED" ||
    err.code === "ECONNRESET";
  if (gone) console.warn(`↯ ${req.method} ${req.originalUrl}: ${err.message}`);
  else console.error(`✗ ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return void res.end();
  const { status, error } = errorBody(err);
  res.status(status).json({ error });
}
