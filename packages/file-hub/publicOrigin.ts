// publicOrigin.ts — the origin a browser reached this hub at, behind a proxy or not: what a pairing returns to and
// what a file service calls its own server. A proxy rewrites Host and says the original in x-forwarded-host.

import type { Request } from "express";

/** The host a browser reached this origin at. */
export const publicHost = (req: Request): string =>
  String(req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim();

/** `https://k7.example.org`, from the forwarded scheme and host. */
export function publicOrigin(req: Request): string {
  const proto = String(req.get("x-forwarded-proto") ?? req.protocol)
    .split(",")[0]
    .trim();
  return `${proto === "https" ? "https" : "http"}://${publicHost(req)}`;
}
