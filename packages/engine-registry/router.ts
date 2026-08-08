// router.ts — the engine registry API, mounted under /api. Two audiences: ENGINES POST
// heartbeat/deregister to announce themselves (no lease — an engine is not a browser tab),
// and the BROWSER GETs /engines and POSTs /engine/select, token-checked. Mounting is the
// host's job: the engine routes must stay open while the browser ones need a session.

import { validate, wrap } from "@frediverse/http/route";
import { Router } from "express";
import { z } from "zod";
import { engineFilesProxy, issueEngineTicket } from "./proxy.ts";
import type { EngineRegistry } from "./registry.ts";

const addressesSchema = z.object({
  loopback: z.string(),
  lanIps: z.array(z.string()),
  port: z.number(),
  filePort: z.number(),
});

// No top-level `port`: it was required here, absent from HeartbeatInput and dropped by upsert(). The one that
// matters is addresses.port. Senders may still send it — zod strips unknown keys — so this is compatible both ways.
const heartbeatBody = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  hostname: z.string(),
  machineFingerprint: z.string(),
  addresses: addressesSchema,
});

const deregisterBody = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
});

// Select CLAIMS the engine for a project, after verifying the token — the backend never connects
// to an engine; the browser does that itself. The driving tab re-POSTs this on an interval to
// renew, carrying the `secret` it was given, and a renewal that no longer matches is refused
// rather than granted. See registry.ts and docs/claim.md for why those are two different calls.
const selectBody = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  // The launch address, `<repo>/<projet>`. Absent or null for a surface that opens on no project
  // — st0 drives an engine without ever holding a project, and must not compete for one.
  project: z.string().nullish(),
  // Absent on the first call, which is an OPEN and always wins; present on every renewal.
  secret: z.string().optional(),
  // Informational: what the browser MEASURED for this link, ms (round trip + the interface's
  // two buffers). Kept on the wire for the constraints this will grow — "no take on a Q3
  // engine" is a question only the server can answer, and only if it was told the number.
  latencyMs: z.number().optional(),
});

// The claim's own secret, not the engine token: a goodbye may only drop the claim it actually
// holds. With the engine token, a tab leaving would drop the claim of whoever took the project
// from it a moment earlier — and that person would read FREE while still driving.
const releaseBody = z.object({
  id: z.string().min(1),
  secret: z.string().min(1),
});

/** The routes over one registry. Each service holds its own — see docs/shared.md. */
export function engineRegistryRouter(reg: EngineRegistry): Router {
  const router = Router();

  router.post(
    "/registry/heartbeat",
    validate(heartbeatBody),
    wrap((req, res) => {
      const b = req.body as z.infer<typeof heartbeatBody>;
      const ok = reg.upsert({
        id: b.id,
        token: b.token,
        hostname: b.hostname,
        machineFingerprint: b.machineFingerprint,
        addresses: b.addresses,
        publicIpHint: req.ip,
      });
      if (!ok) return res.status(409).json({ error: "id/token mismatch" });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/registry/deregister",
    validate(deregisterBody),
    wrap((req, res) => {
      const { id, token } = req.body as z.infer<typeof deregisterBody>;
      if (!reg.remove(id, token))
        return res.status(403).json({ error: "id/token mismatch" });
      res.json({ ok: true });
    }),
  );

  // The pick list. Token stripped; `sameSourceIp` is a LAN hint (Tier 2) from the heartbeat's source IP.
  //
  // Each entry carries a fresh RELAY TICKET. Minted here rather than fetched per engine because
  // this route is already the authenticated one and already returns every engine — a ticket per
  // round trip would have been one round trip per engine, before any of them was measured.
  router.get(
    "/engines",
    wrap((req, res) => {
      res.json(
        reg.list(req.ip).map((e) => ({
          ...e,
          proxyTicket: issueEngineTicket(e.id),
        })),
      );
    }),
  );

  // The engine machine's file service, relayed. Under `/engine/:id/` so the session middleware
  // the hosts put in front of `/api/engine` covers it — see proxy.ts.
  router.use("/engine/:id/files", engineFilesProxy(reg));

  router.post(
    "/engine/select",
    validate(selectBody),
    wrap((req, res) => {
      const { id, token, project, secret } = req.body as z.infer<
        typeof selectBody
      >;
      if (!reg.verifyToken(id, token))
        return res.status(403).json({ error: "unknown engine or bad token" });
      if (!reg.get(id)) return res.status(404).json({ error: "engine gone" });

      // WHO comes from the session, never from the body: this name is shown to the person who
      // gets turned away, and a claim you can sign with someone else's name is not a claim.
      const holder = req.user?.email || req.user?.sub || "";
      const result = reg.claim(id, {
        project: project ?? null,
        holder,
        secret,
      });
      // 409 and not 403: nothing is wrong with this request, the project simply moved on. The
      // client's job is to let go and say so, which is why the holder's name is in the body.
      if (!result.ok)
        return res
          .status(409)
          .json({ error: "project taken", heldBy: result.heldBy });
      res.json({
        ok: true,
        secret: result.secret,
        tookOver: result.tookOver,
      });
    }),
  );

  router.post(
    "/engine/release",
    validate(releaseBody),
    wrap((req, res) => {
      const { id, secret } = req.body as z.infer<typeof releaseBody>;
      // 200 either way: this arrives by `sendBeacon` from a page that is already going, so
      // there is nobody left to read a status. Refusing SILENTLY is the whole of the fix — the
      // claim then simply expires on its own, which is what it was built to do.
      reg.release(id, secret);
      res.json({ ok: true });
    }),
  );

  return router;
}
