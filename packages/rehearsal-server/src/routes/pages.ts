/* Pages: named, shareable collections of releases. */

import { ownerGuard, sub, validate, wrap } from "@frediverse/http";
import { PAGE_VISIBILITIES } from "@studio/rehearsal-shared/pageVisibility";
import { Router } from "express";
import { z } from "zod";
import { serialized } from "../lock.ts";
import * as store from "../store.ts";

const NAMETAG = /^[A-Za-z0-9]+$/;
const nametag = z
  .string()
  .trim()
  .regex(NAMETAG, "nametag must be alphanumeric with no spaces");

const visibility = z.enum(PAGE_VISIBILITIES);

// A new page is private until its owner opens it up — ../../docs/pages.md.
const createSchema = z.object({
  nametag,
  releaseIds: z.array(z.string()).optional().default([]),
  visibility: visibility.optional().default("private"),
});

const patchSchema = z.object({
  nametag: nametag.optional(),
  releaseIds: z.array(z.string()).optional(),
  versionIds: z.record(z.string(), z.string()).optional(),
  visibility: visibility.optional(),
});

export const pagesRouter = Router();

pagesRouter.param("pid", ownerGuard(store.getPageOwner));

pagesRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await store.listPages(sub(req)));
  }),
);

pagesRouter.post(
  "/",
  validate(createSchema),
  wrap(async (req, res) => {
    // Checked and taken under one key, case folded, or two pages created together could share a nametag.
    const key = `nametag:${req.body.nametag.toLowerCase()}`;
    const page = await serialized(key, async () => {
      if (await store.nametagExists(req.body.nametag)) return null;
      return store.createPage(sub(req), req.body);
    });
    if (!page) return res.status(409).json({ error: "nametag already taken" });
    res.status(201).json(page);
  }),
);

pagesRouter.get(
  "/:pid",
  wrap(async (req, res) => {
    const page = await store.getPage(req.params.pid);
    if (!page) return res.status(404).json({ error: "not found" });
    res.json(page);
  }),
);

pagesRouter.patch(
  "/:pid",
  validate(patchSchema),
  wrap(async (req, res) => {
    const { nametag, releaseIds, versionIds, visibility } = req.body;
    const taken = Symbol("taken");
    const page = await serialized(
      `nametag:${nametag?.toLowerCase() ?? req.params.pid}`,
      async () => {
        if (
          nametag !== undefined &&
          (await store.nametagExists(nametag, req.params.pid))
        )
          return taken;
        return store.updatePage(req.params.pid, {
          nametag,
          releaseIds,
          versionIds,
          visibility,
        });
      },
    );
    if (page === taken)
      return res.status(409).json({ error: "nametag already taken" });
    if (!page) return res.status(404).json({ error: "not found" });
    res.json(page);
  }),
);

pagesRouter.delete(
  "/:pid",
  wrap(async (req, res) => {
    const ok = await store.deletePage(req.params.pid);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);
