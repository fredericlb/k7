// loopback.ts — is a request this machine talking to itself? The desktop's and the phone's backend
// answer nobody else (../docs/standalone.md). The Host header counts as much as the peer address:
// a page on a rebound DNS name reaches 127.0.0.1 from the user's own browser, with a foreign Host.

import {
  isLoopbackAddress,
  isLoopbackHost,
} from "@studio/web-protocol/services";
import type { NextFunction, Request, Response } from "express";

/** A `Host` header, port included, naming this machine; absent or unparsable is not loopback. */
export function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return isLoopbackHost(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** Both halves: the peer is this machine, and the page asked for this machine by name. */
export function isLoopbackRequest(req: Request): boolean {
  return (
    isLoopbackAddress(req.socket.remoteAddress) &&
    isLoopbackHostHeader(req.headers.host)
  );
}

/** Refuses every request that is not loopback on both halves. */
export function loopbackOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isLoopbackRequest(req)) {
    next();
    return;
  }
  res.status(403).send("This server answers its own machine only.");
}
