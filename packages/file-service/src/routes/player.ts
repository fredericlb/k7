// player.ts — playing a song from THIS machine's cache, on its own outputs, without the engine.
// Per person and without a workspace: what one listens to belongs to no project.
// See ../../docs/machinePlayer.md.

import { validate, wrap } from "@frediverse/http/route";
import { Router } from "express";
import { z } from "zod";
import {
  play,
  playerAvailable,
  seek,
  setPaused,
  state,
  stop,
} from "../machinePlayer.ts";

export const playerRouter: Router = Router();

/** The state, and enough to know whether the destination is possible at all. Polled while playing:
 *  it is what gives the bottom bar its position, mpv being on another machine with no way to push
 *  it to the browser. */
playerRouter.get(
  "/player",
  wrap(async (req, res) => {
    if (!(await playerAvailable()))
      return res
        .status(503)
        .json({ error: "mpv n'est pas installé sur cette machine" });
    res.json(await state(req.userEmail!));
  }),
);

// The path is RELATIVE to the médiathèque, never absolute: that is what keeps a client naming only
// what this machine caches. See `resolveInMediatek`.
const playBody = z.object({
  path: z.string().min(1),
  from: z.number().min(0).optional(),
});
playerRouter.post(
  "/player/play",
  validate(playBody),
  wrap(async (req, res) => {
    const { path, from } = req.body as z.infer<typeof playBody>;
    try {
      await play(req.userEmail!, path, from ?? 0);
      res.json(await state(req.userEmail!));
    } catch (e) {
      // Refused path, missing file, missing mpv: all fixable by the caller or by whoever sets the
      // machine up, so 400 and the sentence as it is.
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

const pauseBody = z.object({ paused: z.boolean() });
playerRouter.post(
  "/player/pause",
  validate(pauseBody),
  wrap(async (req, res) => {
    await setPaused(
      req.userEmail!,
      (req.body as z.infer<typeof pauseBody>).paused,
    );
    res.json(await state(req.userEmail!));
  }),
);

const seekBody = z.object({ to: z.number().min(0) });
playerRouter.post(
  "/player/seek",
  validate(seekBody),
  wrap(async (req, res) => {
    await seek(req.userEmail!, (req.body as z.infer<typeof seekBody>).to);
    res.json(await state(req.userEmail!));
  }),
);

/** Silence it. mpv stays idle — restarting it for every song would cost a process launch for
 *  nothing. */
playerRouter.post(
  "/player/stop",
  wrap(async (req, res) => {
    await stop(req.userEmail!);
    res.json(await state(req.userEmail!));
  }),
);
