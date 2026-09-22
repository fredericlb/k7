// cors.ts — st0 (and z0, still living on st0's origin) and k7 both call this backend's API
// directly now that pl8 is its own origin, so those origins must be named explicitly or the
// browser refuses the response. Deny-by-default; never reflect an arbitrary origin.

import type { NextFunction, Request, RequestHandler, Response } from "express";

// A factory, not a module-level constant: server.ts loads env.yaml into
// process.env (Object.assign, ../docs/config.md) in its OWN top-level code,
// which only runs AFTER every import — including this one — has already been
// evaluated. Reading TRUSTED_ORIGINS at import time would always see it empty.
export function createTrustedOriginCors(): RequestHandler {
  const trusted = (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && trusted.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
