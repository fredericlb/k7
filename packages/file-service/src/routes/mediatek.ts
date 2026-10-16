// mediatek.ts — the médiathèque as THIS SERVICE reads it: the summary, a family's listing, one
// file's bytes and one song's waveform, all read-only. Mounted BEFORE resolveWorkspace: the
// library belongs to no workspace, the way /workspaces belongs to none. See docs/mediatekRoutes.md.

import { streamFile } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { listFamily, summary } from "@studio/mediatek/catalogue";
import {
  mediatekDir,
  PathEscapesError,
  readablePath,
} from "@studio/mediatek/layout";
import { mimeFor } from "@studio/mediatek/media";
import { asFamily, FAMILY_ERROR } from "@studio/mediatek/types";
import { Router } from "express";
import { ensureFileEnvelope } from "../waveformCache.ts";

export const mediatekRouter: Router = Router();

/** What the library holds and where; `present: false` is normal, never a 404. */
mediatekRouter.get(
  "/mediatek",
  wrap(async (_req, res) => {
    res.json({ ...(await summary()), root: mediatekDir(), cached: true });
  }),
);

/** One family's entries, stamped with the token they were read at. */
mediatekRouter.get(
  "/mediatek/list",
  wrap(async (req, res) => {
    const family = asFamily(req.query.family);
    if (!family) return res.status(400).json({ error: FAMILY_ERROR });
    res.json(await listFamily(family));
  }),
);

/** One library file's BYTES, read-only and confined by `readablePath` — see docs/mediatekRoutes.md. */
mediatekRouter.get(
  "/mediatek/file",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path is required" });
    try {
      // The mime is REQUIRED: `streamFile` sets it unconditionally and `undefined` threw a 500.
      return streamFile(req, res, readablePath(rel), mimeFor(rel));
    } catch (e) {
      // A path that escapes is the caller's mistake, not ours: 400, never 500.
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      return res.status(404).json({ error: (e as Error).message });
    }
  }),
);

/** One song's WAVEFORM, as JSON rather than sidecar bytes — see docs/mediatekRoutes.md. */
mediatekRouter.get(
  "/mediatek/envelope",
  wrap(async (req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path is required" });
    let abs: string;
    try {
      abs = readablePath(rel); // the same confinement /mediatek/file uses
    } catch (e) {
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      return res.status(400).json({ error: (e as Error).message });
    }
    try {
      // Throws its own ENOENT for a file the library has not got, so no separate existence check.
      return res.json(await ensureFileEnvelope(abs, findEngineBinary()));
    } catch (e) {
      const message = (e as Error).message;
      const code = (e as NodeJS.ErrnoException).code;
      return res
        .status(
          code === "ENOENT"
            ? 404
            : message.includes("engine binary")
              ? 503
              : 500,
        )
        .json({ error: message });
    }
  }),
);
