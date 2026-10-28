/* Singing exercises: the band's common practice book — a title, and what to do.
   Shared, like the library's songs, and for the same reason — ../../docs/ownership.md. */

import { sub, validate, wrap } from "@frediverse/http";
import { isYouTubeUrl } from "@studio/rehearsal-shared/youtube";
import { Router } from "express";
import { z } from "zod";
import * as store from "../store.ts";

/** Empty is a legitimate state — an exercise needs no demo; anything else must be a YouTube link. */
const videoUrl = z
  .string()
  .trim()
  .refine(
    (v) => v === "" || isYouTubeUrl(v),
    "a demo link must be a YouTube URL",
  );

const createSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  videoUrl: videoUrl.optional().default(""),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  videoUrl: videoUrl.optional(),
});

export const singingRouter: Router = Router();

singingRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await store.listSingingExercises(sub(req)));
  }),
);

singingRouter.post(
  "/",
  validate(createSchema),
  wrap(async (req, res) => {
    res.status(201).json(await store.createSingingExercise(sub(req), req.body));
  }),
);

singingRouter.patch(
  "/:eid",
  validate(patchSchema),
  wrap(async (req, res) => {
    // Anyone may improve an entry, exactly as anyone may edit a song of the shared library.
    const updated = await store.updateSingingExercise(
      req.params.eid,
      req.body,
      sub(req),
    );
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  }),
);

singingRouter.delete(
  "/:eid",
  wrap(async (req, res) => {
    // Anyone adds to the book; removing an entry is its author's alone.
    if ((await store.getSingingExerciseOwner(req.params.eid)) !== sub(req))
      return res
        .status(403)
        .json({ error: "only the author can delete this exercise" });
    if (!(await store.deleteSingingExercise(req.params.eid)))
      return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);
