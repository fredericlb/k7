// mediatek.ts — the media library over HTTP. Read-only: it lists what is on disk and
// says how stale a listing is, and nothing here writes. Mounted BEFORE resolveWorkspace
// because the library is per MACHINE — a workspace has nothing to do with it, the same
// way /workspaces and /ssh-key need only the user.

import { validate, wrap } from "@frediverse/http/route";
import { listFamily, search, summary } from "@studio/mediatek/catalogue";
import { importFromWorkspace } from "@studio/mediatek/ingest";
import { exists, mediatekDir } from "@studio/mediatek/layout";
import { revisions } from "@studio/mediatek/revision";
import { FAMILIES, type Family } from "@studio/mediatek/types";
import { Router } from "express";
import { z } from "zod";
import { slugify, workspaceRoot } from "../slug.ts";

export const mediatekRouter: Router = Router();

const asFamily = (v: unknown): Family | undefined =>
  FAMILIES.includes(v as Family) ? (v as Family) : undefined;

/** What the catalogue screen opens with: is there a library, and how much is in it.
 *  `present: false` is a normal answer — nothing has created one yet — never a 404. */
mediatekRouter.get(
  "/mediatek",
  wrap((_req, res) => {
    res.json({ ...summary(), root: mediatekDir() });
  }),
);

/** Every family's change token in one call, so a surface polls this and refetches only
 *  the listing that actually moved. The whole reason the tokens are per family. */
mediatekRouter.get(
  "/mediatek/revision",
  wrap((_req, res) => {
    if (!exists()) return res.json({ present: false, revisions: {} });
    res.json({ present: true, revisions: revisions() });
  }),
);

/** One family's entries, stamped with the token they were read at. */
mediatekRouter.get(
  "/mediatek/list",
  wrap((req, res) => {
    const family = asFamily(req.query.family);
    if (!family)
      return res
        .status(400)
        .json({ error: `family must be one of: ${FAMILIES.join(", ")}` });
    res.json(listFamily(family));
  }),
);

/**
 * Copy a workspace's `_modules` / `_library` / `_ui` into the library.
 *
 * The one route here that writes. Additive — it never replaces what is already in the
 * library (see @studio/mediatek/docs/ingest.md) — and it answers with exactly what it
 * copied and what it left alone, which is what makes it undoable by hand.
 *
 * The workspace is resolved from the AUTHENTICATED user, not from anything the caller
 * sends beyond a name, so this cannot be pointed at somebody else's folder.
 */
const importBody = z.object({ workspace: z.string().min(1) });
mediatekRouter.post(
  "/mediatek/import",
  validate(importBody),
  wrap((req, res) => {
    const { workspace } = req.body as z.infer<typeof importBody>;
    let root: string;
    try {
      root = workspaceRoot(slugify(req.userEmail!), workspace);
    } catch (e) {
      // assertWorkspaceName refuses anything that isn't one plain path segment.
      return res.status(400).json({ error: (e as Error).message });
    }
    res.json(importFromWorkspace(root));
  }),
);

/** Filter across families. `limit` is clamped rather than trusted: this walks an array
 *  in memory, but an unbounded one asked for by a caller is still a caller's decision
 *  about our memory. */
mediatekRouter.get(
  "/mediatek/search",
  wrap((req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 1000)
        : undefined;
    res.json({
      entries: search({
        family: asFamily(req.query.family),
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
        limit,
      }),
    });
  }),
);
