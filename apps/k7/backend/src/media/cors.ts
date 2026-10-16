// cors.ts — which origins may make a credentialed call here and read the answer, and the refusal
// of a cross-site write. The session cookie is SameSite=None wherever COOKIE_DOMAIN is set, so an
// origin outside the list must get no CORS answer and no write. See ../../docs/media/cors.md.

import {
  ENGINE_ID_HEADER,
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import { isLoopbackHost } from "@studio/web-protocol/services";
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

/** The methods a cross-site page may send with no say from this server. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface OriginPolicy {
  /** The cookie's `Domain`, leading dot or not; empty when the cookie is host-only. */
  cookieDomain: string;
  /** `TRUSTED_ORIGINS`, as origins. */
  trusted: readonly string[];
  /** Loopback pages are callers too: only on a machine of the user's, never on a hosted origin. */
  loopback: boolean;
}

/** The policy this process runs under, read from the environment `setupAuth` reads too. */
export function originPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): OriginPolicy {
  const cookieDomain = (env.COOKIE_DOMAIN ?? "").trim();
  const trusted = (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    cookieDomain,
    trusted,
    loopback: env.STUDIO_LOCAL_USER === "1" || cookieDomain === "",
  };
}

const originOf = (s: string): string | null => {
  try {
    return new URL(s).origin;
  } catch {
    return null;
  }
};

/** Whether `origin` may call with credentials; `requestHost` is the host the request was addressed to. */
export function isAllowedOrigin(
  origin: string,
  requestHost: string,
  policy: OriginPolicy,
): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (requestHost !== "" && u.host === requestHost.toLowerCase()) return true;
  if (policy.trusted.some((t) => originOf(t) === u.origin)) return true;
  const domain = policy.cookieDomain.replace(/^\./, "").toLowerCase();
  if (
    domain !== "" &&
    u.protocol === "https:" &&
    (u.hostname === domain || u.hostname.endsWith(`.${domain}`))
  )
    return true;
  return policy.loopback && isLoopbackHost(u.hostname);
}

/** Whether a request must be refused as a cross-site write, given what `isAllowedOrigin` said. */
export function isCrossSiteWrite(
  method: string,
  origin: string | undefined,
  fetchSite: string | undefined,
  allowed: boolean,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (origin !== undefined) return !allowed;
  return fetchSite === "cross-site";
}

/** The host the browser addressed: the edge's forwarded one first, as `publicOrigin` reads it. */
const requestHost = (req: Request): string =>
  (req.get("x-forwarded-host")?.split(",")[0] ?? req.get("host") ?? "").trim();

export function studioCors(policy: OriginPolicy): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowed =
      origin !== undefined && isAllowedOrigin(origin, requestHost(req), policy);
    if (origin !== undefined) res.setHeader("Vary", "Origin");
    // Reflected, not "*": a browser refuses "*" with credentials.
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
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
    const site = req.headers["sec-fetch-site"];
    if (
      isCrossSiteWrite(
        req.method,
        origin,
        typeof site === "string" ? site : undefined,
        allowed,
      )
    ) {
      res.status(403).json({ error: "cross-site request refused" });
      return;
    }
    next();
  };
}
