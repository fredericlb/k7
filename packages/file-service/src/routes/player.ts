// player.ts — jouer un morceau du cache de CETTE machine, sur ses propres sorties, sans le
// moteur. Par personne et sans espace de travail : ce qu'on écoute n'appartient à aucun projet.
// Voir ../../docs/machinePlayer.md.

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

/** L'état, et de quoi savoir si la destination est seulement possible. Interrogé pendant la
 *  lecture : c'est ce qui donne la position à la barre du bas, mpv étant sur une autre
 *  machine et n'ayant aucun moyen de la pousser jusqu'au navigateur. */
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

// Le chemin est RELATIF à la médiathèque, jamais absolu : c'est ce qui fait qu'un client ne
// peut nommer que ce que cette machine cache. Voir `resolveInMediatek`.
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
      // Chemin refusé, fichier absent, mpv manquant : tous corrigeables par l'appelant ou par
      // qui installe la machine, donc 400 et la phrase telle quelle.
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

/** Faire taire. mpv reste en veille — le relancer à chaque morceau coûterait un démarrage de
 *  processus pour rien. */
playerRouter.post(
  "/player/stop",
  wrap(async (req, res) => {
    await stop(req.userEmail!);
    res.json(await state(req.userEmail!));
  }),
);
