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

// Select only marks the engine assigned, after verifying the token — the backend never connects to an engine;
// the browser does that itself. The driving tab re-POSTs this on an interval to renew the lease.
const selectBody = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  // Informational: what the browser MEASURED for this link, ms (round trip + the interface's
  // two buffers). Kept on the wire for the constraints this will grow — "no take on a Q3
  // engine" is a question only the server can answer, and only if it was told the number.
  latencyMs: z.number().optional(),
});

const releaseBody = z.object({ id: z.string().min(1) });

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
      const { id, token } = req.body as z.infer<typeof selectBody>;
      if (!reg.verifyToken(id, token))
        return res.status(403).json({ error: "unknown engine or bad token" });
      if (!reg.get(id)) return res.status(404).json({ error: "engine gone" });
      reg.assign(id);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/engine/release",
    validate(releaseBody),
    wrap((req, res) => {
      const { id } = req.body as z.infer<typeof releaseBody>;
      reg.release(id);
      res.json({ ok: true });
    }),
  );

  return router;
}
