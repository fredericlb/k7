// cors.ts — st0, k7 and z0 all call this backend's API directly, from subdomains and dev
// hosts that can't be enumerated in advance, so every origin's credentialed request is
// answered rather than checked against a list. See docs/cors.md for what that costs.

import {
  ENGINE_ID_HEADER,
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** What a page may send: the file hub's calls carry the studio headers, never the hub secret. */
const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  USER_HEADER,
  WORKSPACE_HEADER,
  ENGINE_TOKEN_HEADER,
  ENGINE_ID_HEADER,
].join(", ");

export const openCors: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const origin = req.headers.origin;
  // Reflected, not "*": a browser refuses that combination once credentials are allowed, so
  // answering every origin means echoing back whichever one actually asked.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
};
