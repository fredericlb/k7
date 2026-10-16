// uploads.ts — a route that takes files on disk removes whatever it did not keep, whatever it answered.
// What reads wrong: the store MOVES a file it keeps, so what is left here was refused or failed.

import { wrap } from "@frediverse/http";
import type { Request, Response } from "express";
import * as store from "./store.ts";

/** Every file a request carried, so what the store did not keep can be removed. */
const uploadsOf = (req: Request): { path?: string }[] => [
  ...(req.file ? [req.file] : []),
  ...(Array.isArray(req.files)
    ? req.files
    : Object.values(req.files ?? {}).flat()),
];

/** The handler, then the leftovers removed whatever it answered. */
export const keepingUploads = (fn: (req: Request, res: Response) => unknown) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } finally {
      store.discardUploads(uploadsOf(req));
    }
  });
