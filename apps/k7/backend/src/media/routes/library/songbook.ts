// songbook.ts — the library's songbook routes: a song's lyrics, tablature and sheets, kept in its
// folder and addressed by the sidecar's uuid. The rehearsal server is the caller, over loopback with
// its service token — packages/mediatek/docs/songbook.md.

import { wrap } from "@frediverse/http/route";
import { NotAudioError } from "@studio/mediatek/song";
import {
  addSongbookSheet,
  createSongbook,
  deleteSongbook,
  detachSongbook,
  listSongbook,
  moveSongbook,
  patchSongbook,
  readSongbook,
  readSongbookAt,
  removeSongbookSheet,
  SongbookRefusedError,
  setSongbookMaster,
} from "@studio/mediatek/songbook";
import { UntaggableError } from "@studio/mediatek/tags";
import express, { type Request, type Response, Router } from "express";
import { z } from "zod";
import { mayManageLibrary } from "../../libraryGate.ts";
import { lyricsQueue } from "../../lyricsQueue.ts";
import { rawToDisk, uploadOf } from "../../upload.ts";
import { writeError } from "./write.ts";

export const songbookRoutes: Router = Router();

/** The rehearsal server's own bearer: it applied the songbook's rule on who deletes before calling. */
const SONGBOOK_SERVICE = "service:k7";

/** Refusals the caller can fix, as 4xx; anything else is the server's. */
function refused(e: unknown, res: Response): boolean {
  if (e instanceof SongbookRefusedError || e instanceof NotAudioError) {
    res.status(e.message.startsWith("no song") ? 404 : 400).json({
      error: e.message,
    });
    return true;
  }
  if (e instanceof UntaggableError) {
    res.status(422).json({ error: e.message });
    return true;
  }
  return writeError(e, res);
}

/** Run `fn` and answer its song, or the refusal it threw. */
const answer = (fn: (req: Request) => Promise<unknown>) =>
  wrap(async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      if (!refused(e, res)) throw e;
    }
  });

const createBody = z.object({
  artist: z.string().trim().min(1),
  title: z.string().trim().min(1),
  owner: z.string().default(""),
});

const fetchBody = z
  .object({
    phase: z.string(),
    progress: z.number().nullable(),
    error: z.string(),
    huntId: z.string(),
    jobId: z.string(),
  })
  .partial();

const patchBody = z
  .object({
    artist: z.string(),
    title: z.string(),
    lyrics: z.string(),
    tablature: z.string(),
    lyricsMatch: z.string(),
    fetchIgnored: z.boolean(),
    fetch: fetchBody,
    instrumental: z.string(),
    origin: z.string(),
  })
  .partial();

songbookRoutes.get(
  "/songbook",
  wrap(async (_req, res) => {
    res.json(await listSongbook());
  }),
);

songbookRoutes.get(
  "/songbook/:id",
  wrap(async (req, res) => {
    const song = await readSongbook(req.params.id);
    if (!song) return res.status(404).json({ error: "no such song" });
    res.json(song);
  }),
);

songbookRoutes.post(
  "/songbook",
  express.json(),
  answer(async (req) => {
    const body = createBody.parse(req.body ?? {});
    // The médiathèque names no owner: the account that made it is who created it.
    const owner = body.owner || ((req.user as { sub?: string })?.sub ?? "");
    return readSongbookAt(createSongbook({ ...body, owner }).path);
  }),
);

songbookRoutes.patch(
  "/songbook/:id",
  express.json(),
  answer((req) =>
    patchSongbook(req.params.id, patchBody.parse(req.body ?? {})),
  ),
);

/** One sheet, raw body: the name and type come in the query, the bytes are streamed to disk. */
songbookRoutes.post(
  "/songbook/:id/sheets",
  rawToDisk(),
  answer((req) => {
    const upload = uploadOf(req);
    if (!upload.size) throw new SongbookRefusedError("empty sheet");
    return addSongbookSheet(req.params.id, {
      bytes: { file: upload.file },
      name: String(req.query.name ?? "sheet"),
      mime: String(req.query.mime ?? "application/octet-stream"),
    });
  }),
);

songbookRoutes.delete(
  "/songbook/:id/sheets/:sheet",
  answer((req) => removeSongbookSheet(req.params.id, req.params.sheet)),
);

/** The song's reference track, raw body: it becomes the master of the song's own folder. */
songbookRoutes.post(
  "/songbook/:id/master",
  rawToDisk(),
  answer(async (req) => {
    const upload = uploadOf(req);
    if (!upload.size) throw new SongbookRefusedError("empty track");
    const song = await setSongbookMaster(req.params.id, {
      filename: String(req.query.filename ?? ""),
      bytes: { file: upload.file },
    });
    lyricsQueue.want(song.path);
    return song;
  }),
);

/** The song becomes the library song at `to`, its texts and sheets carried there. */
songbookRoutes.post(
  "/songbook/:id/move",
  express.json(),
  answer((req) =>
    moveSongbook(
      req.params.id,
      String((req.body as { to?: string })?.to ?? ""),
    ),
  ),
);

/** The song leaves its audio behind, for a folder of its own. */
songbookRoutes.post(
  "/songbook/:id/detach",
  answer((req) => detachSongbook(req.params.id)),
);

songbookRoutes.delete(
  "/songbook/:id",
  wrap(async (req, res) => {
    const caller = (req.user as { sub?: string } | undefined)?.sub;
    if (caller !== SONGBOOK_SERVICE && !mayManageLibrary(req))
      return res
        .status(403)
        .json({ error: "only an admin may remove a songbook song" });
    try {
      await deleteSongbook(req.params.id);
      res.status(204).end();
    } catch (e) {
      if (!refused(e, res)) throw e;
    }
  }),
);
