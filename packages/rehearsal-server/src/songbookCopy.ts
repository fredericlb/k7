// songbookCopy.ts — a paired machine's songbook against its server's: the server reads a device the songs
// its person may see, and the machine places its own against them and copies one down, sheets and track with it.
// What reads wrong: a copy keeps the song's id, which is how "on both" is told — ../docs/songbookCopy.md.

import { sub, wrap } from "@frediverse/http";
import type {
  SheetFile,
  SongbookPlacement,
  SongSummary,
} from "@studio/rehearsal-shared";
import {
  type Response as ExpressResponse,
  type RequestHandler,
  Router,
} from "express";
import * as db from "./db.ts";
import type * as Declared from "./index.d.ts";
import { streamSheet } from "./serve.ts";
import { ensureSheetFileCached, invalidateSong } from "./store.ts";

/** The facts a copy carries; the owner and the fetch pipeline's state are the machine's own. */
const CARRIED = [
  "Artist",
  "Title",
  "Lyrics",
  "LyricTimings",
  "Tablature",
  "Envelope",
  "AudioPath",
  "AudioMime",
  "AudioName",
  "InstrumentalPath",
  "InstrumentalMime",
  "InstrumentalName",
  "LyricsMatch",
  "FetchIgnored",
  "Private",
  "CreatedAt",
] as const;

/** One song as the server hands it to a device. */
interface SongCopy {
  fields: Record<string, unknown>;
  sheets: SheetFile[];
}

type Fields = Record<string, unknown>;

const sheetsOf = (f: Fields): (SheetFile & { attachmentId: string })[] => {
  try {
    const v = JSON.parse(String(f.SheetMeta || "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** The person who paired the device, as `deviceGate` left them; null for an older token that names nobody. */
const personOf = (res: ExpressResponse): string | null =>
  (res.locals.syncCaller as { person?: string | null } | undefined)?.person ??
  null;

/** What a device may see: a public song, or a private one of the person who paired it. */
const visible = (f: Fields, person: string | null): boolean =>
  !f.Private || (person !== null && f.OwnerId === person);

/** A song's record when the device may see it, else null. */
async function songFor(uid: string, res: ExpressResponse) {
  const [rec] = await db.listRecords<Fields>("Songs", { Uid: [uid] });
  return rec && visible(rec.fields, personOf(res)) ? rec : null;
}

/** The server's side: the songs the device's person may see, read-only, behind a device token (`gate`). */
export const songbookDeviceRouter: typeof Declared.songbookDeviceRouter = (
  gate: RequestHandler,
) => {
  const r = Router();
  r.use(gate);
  r.get(
    "/",
    wrap(async (_req, res) => {
      const recs = await db.listRecords<Fields>("Songs", undefined, {
        fields: ["Uid", "Artist", "Title", "Private", "OwnerId"],
      });
      const songs: SongSummary[] = recs
        .filter((r) => visible(r.fields, personOf(res)))
        .map((r) => ({
          id: String(r.fields.Uid),
          artist: String(r.fields.Artist ?? ""),
          title: String(r.fields.Title ?? ""),
          private: Boolean(r.fields.Private),
        }));
      res.json(songs);
    }),
  );
  r.get(
    "/:uid",
    wrap(async (req, res) => {
      const rec = await songFor(req.params.uid, res);
      if (!rec) return res.status(404).json({ error: "no such song" });
      const copy: SongCopy = {
        fields: Object.fromEntries(CARRIED.map((k) => [k, rec.fields[k]])),
        sheets: sheetsOf(rec.fields).map(({ id, name, mime }) => ({
          id,
          name,
          mime,
        })),
      };
      res.json(copy);
    }),
  );
  r.get(
    "/:uid/sheets/:fid",
    wrap(async (req, res) => {
      if (!(await songFor(req.params.uid, res)))
        return res.status(404).json({ error: "no such song" });
      const info = await ensureSheetFileCached(req.params.uid, req.params.fid);
      if (!info) return res.status(404).json({ error: "no such sheet" });
      streamSheet(req, res, info);
    }),
  );
  return r;
};

/** The machine's side: `GET /` places its songs, `POST /download {id}` copies one server-only song here. */
export const songbookCopyRouter: typeof Declared.songbookCopyRouter = (
  opts,
) => {
  const r = Router();

  r.get(
    "/",
    wrap(async (req, res) => {
      const server = opts.server(req);
      if (!server) {
        const none: SongbookPlacement = {
          paired: false,
          server: null,
          synced: [],
          serverOnly: [],
        };
        return res.json(none);
      }
      let theirs: SongSummary[];
      try {
        // Bounded: the songbook must not wait on a server that is away.
        const got = await fetch(`${server.base}${opts.deviceRoute}`, {
          headers: { authorization: `Bearer ${server.token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!got.ok) throw new Error(`${got.status} ${got.statusText}`);
        theirs = (await got.json()) as SongSummary[];
      } catch (e) {
        return res.status(502).json({
          error: `could not list ${server.base}'s songbook: ${(e as Error).message}`,
        });
      }
      const here = new Set(
        (
          await db.listRecords<Fields>("Songs", undefined, { fields: ["Uid"] })
        ).map((r) => String(r.fields.Uid)),
      );
      const placement: SongbookPlacement = {
        paired: true,
        server: server.base,
        synced: theirs.filter((s) => here.has(s.id)).map((s) => s.id),
        serverOnly: theirs.filter((s) => !here.has(s.id)),
      };
      res.json(placement);
    }),
  );

  r.post(
    "/download",
    wrap(async (req, res) => {
      const id = typeof req.body?.id === "string" ? req.body.id : "";
      if (!id) return res.status(400).json({ error: "id is required" });
      const server = opts.server(req);
      if (!server)
        return res.status(409).json({ error: "this account is not paired" });
      if ((await db.listRecords("Songs", { Uid: [id] })).length)
        return res.json({ ok: true, already: true });
      const at = `${server.base}${opts.deviceRoute}/${encodeURIComponent(id)}`;
      const get = async (url: string): Promise<Response> => {
        const got = await fetch(url, {
          headers: { authorization: `Bearer ${server.token}` },
          signal: AbortSignal.timeout(5 * 60_000),
        });
        if (!got.ok) throw new Error(`${url}: ${got.status} ${got.statusText}`);
        return got;
      };
      try {
        const song = (await (await get(at)).json()) as SongCopy;
        // Everything is fetched before anything is written: a failed copy leaves nothing half there.
        const sheets = await Promise.all(
          song.sheets.map(async (s) => ({
            ...s,
            bytes: Buffer.from(
              await (
                await get(`${at}/sheets/${encodeURIComponent(s.id)}`)
              ).arrayBuffer(),
            ),
          })),
        );
        for (const k of ["AudioPath", "InstrumentalPath"] as const) {
          const path = String(song.fields[k] ?? "");
          if (path.startsWith("songs/")) await opts.fetchTrack(req, path);
        }
        const [{ id: recId }] = await db.addRecords("Songs", [
          {
            ...song.fields,
            Uid: id,
            OwnerId: sub(req),
            Origin: server.base,
            SheetMeta: "[]",
          },
        ]);
        const meta: (SheetFile & { attachmentId: string })[] = [];
        for (const s of sheets)
          meta.push({
            id: s.id,
            attachmentId: await db.uploadAttachment(
              s.bytes,
              s.mime,
              s.name,
              recId,
            ),
            name: s.name,
            mime: s.mime,
          });
        await db.patchRecord("Songs", recId, {
          SheetMeta: JSON.stringify(meta),
        });
        invalidateSong(id);
        res.json({ ok: true, sheets: meta.length });
      } catch (e) {
        res.status(502).json({ error: (e as Error).message });
      }
    }),
  );

  return r;
};
