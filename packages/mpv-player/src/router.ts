// router.ts — the HTTP surface over player.ts, mounted unchanged by every host: per person,
// and without a workspace, because what one listens to belongs to no project. WHO is asking
// is the host's to answer — the file service reads a header, pl8 reads its session — so it
// hands that in rather than this package declaring a request shape. See ../docs/mpvPlayer.md.

import { validate, wrap } from "@frediverse/http/route";
import { type Request, Router } from "express";
import { z } from "zod";
import {
  play,
  playerAvailable,
  seek,
  setPaused,
  state,
  stop,
} from "./player.ts";

/** The person a request plays for. One mpv each, so this is what keeps two listeners apart. */
export type Whoami = (req: Request) => string;

// The path is RELATIVE to the host's media root, so a client can name only what this host holds.
const playBody = z.object({
  path: z.string().min(1),
  from: z.number().min(0).optional(),
});
const pauseBody = z.object({ paused: z.boolean() });
const seekBody = z.object({ to: z.number().min(0) });

/** The routes exist only where mpv does: probed once at boot, absent they 404 like any unknown path. */
export function createPlayerRouter(whoami: Whoami): Router {
  const playerRouter: Router = Router();
  const present = playerAvailable();
  void present.then((ok) => {
    if (!ok) console.warn("mpv: not installed, so this host offers no player");
  });
  playerRouter.use("/player", (_req, _res, next) => {
    present.then((ok) => next(ok ? undefined : "router"), next);
  });

  /** The state, polled while playing: mpv cannot push its position to a browser. */
  playerRouter.get(
    "/player",
    wrap(async (req, res) => {
      res.json(await state(whoami(req)));
    }),
  );

  playerRouter.post(
    "/player/play",
    validate(playBody),
    wrap(async (req, res) => {
      const { path, from } = req.body as z.infer<typeof playBody>;
      try {
        await play(whoami(req), path, from ?? 0);
        res.json(await state(whoami(req)));
      } catch (e) {
        // Refused path, missing file, missing mpv: all fixable, so 400 and the sentence as it is.
        res.status(400).json({ error: (e as Error).message });
      }
    }),
  );

  playerRouter.post(
    "/player/pause",
    validate(pauseBody),
    wrap(async (req, res) => {
      await setPaused(
        whoami(req),
        (req.body as z.infer<typeof pauseBody>).paused,
      );
      res.json(await state(whoami(req)));
    }),
  );

  playerRouter.post(
    "/player/seek",
    validate(seekBody),
    wrap(async (req, res) => {
      await seek(whoami(req), (req.body as z.infer<typeof seekBody>).to);
      res.json(await state(whoami(req)));
    }),
  );

  /** Silence it; mpv stays idle, since restarting it per song costs a process launch for nothing. */
  playerRouter.post(
    "/player/stop",
    wrap(async (req, res) => {
      await stop(whoami(req));
      res.json(await state(whoami(req)));
    }),
  );

  return playerRouter;
}
