// router.ts — the engine registry API, mounted under /api. Two audiences: ENGINES POST
// heartbeat/deregister to announce themselves (no lease — an engine is not a browser tab),
// and the BROWSER GETs /engines and POSTs /engine/select, token-checked. Mounting is the
// host's job: the engine routes must stay open while the browser ones need a session.

import { validate, wrap } from "@frediverse/http/route";
import { Router } from "express";
import { z } from "zod";
import { engineFilesProxy, issueEngineTicket } from "./proxy.ts";
import type { EngineRegistry } from "./registry.ts";

// Addresses are ADDRESSES: `/registry/heartbeat` is open by design, and an unvalidated string would let anyone aim this server at a name.
const addressesSchema = z.object({
  loopback: z.ipv4(),
  lanIps: z.array(z.ipv4()),
  port: z.number().int().min(1).max(65535),
  filePort: z.number().int().min(1).max(65535),
});

// No top-level `port`: the one that matters is addresses.port, and zod strips unknown keys, so a sender may still send it.
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

// Select CLAIMS the engine for a project after verifying the token; the backend never connects to an engine — see docs/claim.md.
const selectBody = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  // The launch address, `<repo>/<projet>`; absent or null for a surface that opens on no project and must not compete for one.
  project: z.string().nullish(),
  // Absent on the first call, which is an OPEN and always wins; present on every renewal.
  secret: z.string().optional(),
  // Informational: what the browser MEASURED for this link in ms, kept on the wire for the constraints this will grow.
  latencyMs: z.number().optional(),
});

// The claim's own secret, not the engine token: a goodbye may only drop the claim it actually holds — see docs/claim.md.
const releaseBody = z.object({
  id: z.string().min(1),
  secret: z.string().min(1),
});

/** The routes over the one registry, pl8's — see docs/shared.md. */
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

  // The pick list, token stripped, each entry carrying a fresh RELAY TICKET minted here rather than per engine — see docs/proxy.md.
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

  // The engine machine's file service, relayed under `/engine/:id/` so the session middleware in front of `/api/engine` covers it.
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

      // WHO comes from the session, never from the body: a claim you can sign with someone else's name is not a claim.
      const holder = req.user?.email || req.user?.sub || "";
      const result = reg.claim(id, {
        project: project ?? null,
        holder,
        secret,
      });
      // 409 and not 403: nothing is wrong with the request, the project moved on, and the client's job is to let go and say so.
      if (!result.ok)
        return res.status(409).json({
          error: "project taken",
          heldBy: result.heldBy,
          // Which of the three it was; without it the browser can only say "opened elsewhere", which is false two times out of three.
          lost: result.lost,
          tookFor: result.tookFor,
        });
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
      // 200 either way: this arrives by `sendBeacon` from a page already going, so a refused goodbye just lets the claim expire.
      reg.release(id, secret);
      res.json({ ok: true });
    }),
  );

  return router;
}
