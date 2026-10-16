// tokenRoutes.ts — the library's personal access tokens: minted, listed and revoked by their owner,
// behind the SESSION only, since a token must never mint another. See ../../docs/media/gate.md.
// What a reader gets wrong: the pairing route is a GET that mints, kept because its only exit is loopback.

import type { ApiTokenRecord } from "@frediverse/oidc";
import { isLoopbackReturn } from "@studio/web-protocol/pairing";
import type { Express, RequestHandler } from "express";
import { emailOf, subjectOf } from "../who.ts";

/** The verbs of one token scheme, as `apiTokenAuth` returns them. */
export interface TokenVerbs {
  issueApiToken(sub: string, opts?: { label?: string }): string;
  listApiTokens(sub: string): ApiTokenRecord[];
  revokeApiToken(sub: string, id: string): boolean;
}

/** What the owner sees of a token: never the token itself. */
export const publicRecord = (r: ApiTokenRecord) => ({
  id: r.id,
  label: r.label,
  created: r.created,
  expires: r.expires,
  lastUsed: r.lastUsed ?? null,
});

/** A label as typed, bounded so a list stays a list. */
export const labelOf = (raw: unknown, fallback: string): string =>
  typeof raw === "string" && raw.trim() !== ""
    ? raw.trim().slice(0, 80)
    : fallback;

export function mountTokenRoutes(
  app: Express,
  requireAuth: RequestHandler,
  tokens: TokenVerbs,
): void {
  // A token for a DESKTOP app on its loopback port; isLoopbackReturn IS this route's security.
  app.get("/api/token/pair", requireAuth, (req, res) => {
    const back = String(req.query.return ?? "");
    // The predicate is shared with the app that builds this address: one rule, two sides.
    if (!isLoopbackReturn(back))
      return res
        .status(400)
        .json({ error: "return must be an http loopback address" });
    const target = new URL(back);
    const id = subjectOf(req);
    if (!id) return res.status(401).json({ error: "no user on the session" });
    target.searchParams.set(
      "token",
      tokens.issueApiToken(id, { label: "desktop pairing" }),
    );
    target.searchParams.set("identity", emailOf(req) ?? id);
    if (typeof req.query.state === "string")
      target.searchParams.set("state", req.query.state);
    res.redirect(target.toString());
  });

  // POST only: the cross-site write refusal in ./cors.ts is what keeps another site from minting one.
  app.post("/api/token", requireAuth, (req, res) => {
    const id = subjectOf(req);
    if (!id) return res.status(401).json({ error: "no user on the session" });
    const label = labelOf(
      (req.body as { label?: unknown })?.label,
      "API token",
    );
    const token = tokens.issueApiToken(id, { label });
    const record = tokens.listApiTokens(id).at(-1);
    res.json({ token, ...(record ? publicRecord(record) : {}) });
  });

  app.get("/api/token", requireAuth, (req, res) => {
    const id = subjectOf(req);
    if (!id) return res.status(401).json({ error: "no user on the session" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ tokens: tokens.listApiTokens(id).map(publicRecord) });
  });

  app.delete("/api/token/:id", requireAuth, (req, res) => {
    const id = subjectOf(req);
    if (!id) return res.status(401).json({ error: "no user on the session" });
    if (!tokens.revokeApiToken(id, String(req.params.id)))
      return res.status(404).json({ error: "no such token" });
    res.json({ ok: true });
  });
}
