// ownershipRoutes.ts — what an engine's OWNER does with it from a browser: read and replace the
// accounts it is shared with, or give it up; and what an ADMIN may: list the owners and reset one.
// Nobody else learns that an owned engine exists. Behind the session, like `/engines`. See
// docs/ownership.md.

import { validate, wrap } from "@frediverse/http/route";
import { type Request, Router } from "express";
import { z } from "zod";
import { claimHolder, cleanShares, MAX_SHARED, roleOf } from "./owners.ts";
import type { EngineRegistry } from "./registry.ts";

const sharesBody = z.object({
  emails: z.array(z.string().max(254)).max(MAX_SHARED),
});

/** The owner's and the admin's routes over `reg.owners`. */
export function ownershipRouter(
  reg: EngineRegistry,
  isAdmin: (req: unknown) => boolean,
): Router {
  const router = Router();
  const owners = reg.owners;
  /** Whether the request's account owns `id`. */
  const owns = (id: string, req: Request): boolean =>
    roleOf(owners.get(id), claimHolder(req), false) === "owner";
  // One answer for "not yours" and "no such owned engine", so a stranger cannot tell them apart.
  const notYours = { error: "not-yours" } as const;

  router.get(
    "/engines/owners",
    wrap((req, res) => {
      if (!isAdmin(req)) return res.status(403).json(notYours);
      res.json(owners.all().map(([id, o]) => ({ id, ...o })));
    }),
  );

  router.get(
    "/engines/:id/shares",
    wrap((req, res) => {
      const id = String(req.params.id);
      const o = owners.get(id);
      if (!o || !(owns(id, req) || isAdmin(req)))
        return res.status(404).json(notYours);
      res.json({ owner: o.owner, shared: o.shared, since: o.since });
    }),
  );

  router.put(
    "/engines/:id/shares",
    validate(sharesBody),
    wrap((req, res) => {
      const id = String(req.params.id);
      if (!owns(id, req)) return res.status(404).json(notYours);
      const cleaned = cleanShares(
        (req.body as z.infer<typeof sharesBody>).emails,
      );
      if (!cleaned.ok)
        return res.status(400).json({ error: `not an email: ${cleaned.bad}` });
      owners.share(id, cleaned.emails);
      // A withdrawn share ends that account's claim now, not when its tab next renews.
      const o = owners.get(id);
      reg.evict(id, (h) => roleOf(o, h, false) !== "none");
      res.json({ ok: true, shared: o?.shared ?? [] });
    }),
  );

  // The owner gives it up, or an admin resets it; claims stay, and the next direct open enrols it again.
  router.delete(
    "/engines/:id/owner",
    wrap((req, res) => {
      const id = String(req.params.id);
      if (!owners.get(id) || !(owns(id, req) || isAdmin(req)))
        return res.status(404).json(notYours);
      owners.release(id);
      res.json({ ok: true });
    }),
  );

  return router;
}
