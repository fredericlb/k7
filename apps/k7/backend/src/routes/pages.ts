/* Pages: named, shareable collections of releases. */

import { ownerGuard, sub, validate, wrap } from "@frediverse/http";
import { Router } from "express";
import { z } from "zod";
import * as store from "../store.ts";

const NAMETAG = /^[A-Za-z0-9]+$/;
const nametag = z
  .string()
  .trim()
  .regex(NAMETAG, "nametag must be alphanumeric with no spaces");

const createSchema = z.object({
  nametag,
  releaseIds: z.array(z.string()).optional().default([]),
});

const patchSchema = z.object({
  nametag: nametag.optional(),
  releaseIds: z.array(z.string()).optional(),
  versionIds: z.record(z.string(), z.string()).optional(),
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
    if (await store.nametagExists(req.body.nametag))
      return res.status(409).json({ error: "nametag already taken" });
    const page = await store.createPage(sub(req), req.body);
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
    const { nametag, releaseIds, versionIds } = req.body;
    if (
      nametag !== undefined &&
      (await store.nametagExists(nametag, req.params.pid))
    )
      return res.status(409).json({ error: "nametag already taken" });
    const page = await store.updatePage(req.params.pid, {
      nametag,
      releaseIds,
      versionIds,
    });
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
