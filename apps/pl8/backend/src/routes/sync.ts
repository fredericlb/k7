// sync.ts (routes) — copy a set list onto one of an engine machine's targets. This service
// resolves the playlist (it holds the catalogue) and the machine writes (it holds the target).
// The target's URI never reaches here: it is named. See ../../docs/sync.md.

import { validate, wrap } from "@frediverse/http/route";
import type { EngineMount } from "@studio/engine-registry";
import { type Request, Router } from "express";
import { z } from "zod";
import {
  SyncError,
  startSyncOn,
  syncStatus,
  targetsOn,
  tracksOf,
} from "../sync/push.ts";

/** pl8 has no express type augmentation, so the user is read this way, as in `routes/stems.ts`. */
function emailOf(req: Request): string | null {
  return (req as { user?: { email?: string } }).user?.email ?? null;
}

const body = z.object({
  /** `playlists/`-relative and without the extension, as the listing names one. */
  playlist: z.string().min(1),
  /** Which registered engine holds the target — the browser is already on one. */
  engineId: z.string().min(1),
  /** The target's NAME on that machine; its URI stays there, password included. */
  target: z.string().min(1),
});

export function syncRouter(engines: EngineMount): Router {
  const router: Router = Router();

  /** A registry miss is a 409, not a 404: the engine existed when the browser picked it. */
  const engineOr409 = (id: string) => {
    const engine = engines.registry.get(id);
    if (!engine)
      throw Object.assign(
        new Error(`no engine '${id}' is registered — is its machine running?`),
        { status: 409 },
      );
    return engine;
  };

  const said = (e: unknown): { status: number; error: string } => ({
    status: (e as { status?: number }).status ?? 502,
    error: (e as Error).message,
  });

  /** What that machine can copy to. Empty is a normal answer: most machines have no target. */
  router.get(
    "/targets",
    wrap(async (req, res) => {
      const engineId = String(req.query.engineId ?? "");
      if (!engineId)
        return res.status(400).json({ error: "engineId required" });
      try {
        res.json(
          await targetsOn(engineOr409(engineId), emailOf(req) ?? "unknown"),
        );
      } catch (e) {
        const { status, error } = said(e);
        res.status(e instanceof SyncError ? status : 500).json({ error });
      }
    }),
  );

  /** Start one. The tracks are resolved HERE, so the machine needs no catalogue of its own. */
  router.post(
    "/",
    validate(body),
    wrap(async (req, res) => {
      const { playlist, engineId, target } = req.body as z.infer<typeof body>;
      try {
        const engine = engineOr409(engineId);
        const { tracks, skipped } = tracksOf(playlist);
        // Nothing resolvable is a 400 with the lines named: the remedy is in the playlist.
        if (!tracks.length)
          return res.status(400).json({
            error: `no line of '${playlist}' names a song this volume holds`,
            skipped,
          });
        const job = await startSyncOn({
          engine,
          userEmail: emailOf(req) ?? "unknown",
          target,
          playlist,
          tracks,
        });
        // `skipped` rides along: the run is honest about what it is NOT copying.
        res.json({ job, skipped });
      } catch (e) {
        const { status, error } = said(e);
        res.status(e instanceof SyncError ? status : 500).json({ error });
      }
    }),
  );

  router.get(
    "/:id",
    wrap(async (req, res) => {
      const engineId = String(req.query.engineId ?? "");
      if (!engineId)
        return res.status(400).json({ error: "engineId required" });
      try {
        res.json(
          await syncStatus(
            engineOr409(engineId),
            emailOf(req) ?? "unknown",
            req.params.id,
          ),
        );
      } catch (e) {
        const { status, error } = said(e);
        res.status(e instanceof SyncError ? status : 500).json({ error });
      }
    }),
  );

  return router;
}
