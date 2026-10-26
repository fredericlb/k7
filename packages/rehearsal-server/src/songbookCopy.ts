// songbookCopy.ts — a paired machine's songbook against its server's: the server lists a device its
// songs, and the machine places its own against them and copies one down. A song is a library
// folder, so a copy is that folder brought down whole — texts, sheets and track — then marked with
// where it came from. What reads wrong: the copy keeps the song's id, which is how "on both" is told — ../docs/songbookCopy.md.

import { wrap } from "@frediverse/http";
import type { SongbookPlacement, SongSummary } from "@studio/rehearsal-shared";
import { type Request, type RequestHandler, Router } from "express";
import * as mediatek from "./mediatek.ts";
import type { ServerOf } from "./publications.ts";

/** The server's side: its songbook, read-only, behind a device token (`gate`). */
export const songbookDeviceRouter = (gate: RequestHandler): Router => {
  const r = Router();
  r.use(gate);
  r.get(
    "/",
    wrap(async (_req, res) => {
      const songs: SongSummary[] = (await mediatek.songbook().list()).map(
        (s) => ({ id: s.id, artist: s.artist, title: s.title, path: s.path }),
      );
      res.json(songs);
    }),
  );
  return r;
};

/** The machine's side: `GET /` places its songs, `POST /download {id}` copies one server-only song here. */
export const songbookCopyRouter = (opts: {
  /** Where `songbookDeviceRouter` is mounted on the server. */
  deviceRoute: string;
  server: ServerOf;
  /** Bring the library song folder at `folder` down from that server, every file of it. */
  fetchFolder(req: Request, folder: string): Promise<void>;
}): Router => {
  const r = Router();

  /** The server's songbook, or the error to answer with. */
  const theirs = async (
    req: Request,
  ): Promise<
    | { base: string; songs: SongSummary[] }
    | { error: string; status: number }
    | null
  > => {
    const server = opts.server(req);
    if (!server) return null;
    try {
      // Bounded: the songbook must not wait on a server that is away.
      const got = await fetch(`${server.base}${opts.deviceRoute}`, {
        headers: { authorization: `Bearer ${server.token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!got.ok) throw new Error(`${got.status} ${got.statusText}`);
      return { base: server.base, songs: (await got.json()) as SongSummary[] };
    } catch (e) {
      return {
        status: 502,
        error: `could not list ${server.base}'s songbook: ${(e as Error).message}`,
      };
    }
  };

  r.get(
    "/",
    wrap(async (req, res) => {
      const server = await theirs(req);
      if (!server) {
        const none: SongbookPlacement = {
          paired: false,
          server: null,
          synced: [],
          serverOnly: [],
        };
        return res.json(none);
      }
      if ("error" in server)
        return res.status(server.status).json({ error: server.error });
      const here = new Set((await mediatek.songbook().list()).map((s) => s.id));
      const placement: SongbookPlacement = {
        paired: true,
        server: server.base,
        synced: server.songs.filter((s) => here.has(s.id)).map((s) => s.id),
        serverOnly: server.songs.filter((s) => !here.has(s.id)),
      };
      res.json(placement);
    }),
  );

  r.post(
    "/download",
    wrap(async (req, res) => {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      if (!id) return res.status(400).json({ error: "id is required" });
      const server = await theirs(req);
      if (!server)
        return res.status(409).json({ error: "this account is not paired" });
      if ("error" in server)
        return res.status(server.status).json({ error: server.error });
      if (await mediatek.songbook().get(id))
        return res.json({ ok: true, already: true });
      const song = server.songs.find((s) => s.id === id);
      if (!song) return res.status(404).json({ error: "no such song there" });
      try {
        await opts.fetchFolder(req, song.path);
        // Read-only here from now on: where it came from is what says so.
        if (!(await mediatek.songbook().patch(id, { origin: server.base })))
          throw new Error(`${song.path} came down without its songbook`);
        res.json({ ok: true });
      } catch (e) {
        res.status(502).json({ error: (e as Error).message });
      }
    }),
  );

  return r;
};
