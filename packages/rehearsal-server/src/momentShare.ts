// momentShare.ts — the server's door for a machine's moment: the span, the text, the markers and the audio to cut
// its clip from (a slice or the whole recording), or a clip a machine cut before. Sending again replaces the copy.
// What reads wrong: the copy keeps the machine's moment id, which is how "shared" is told — ../docs/momentShare.md.

import { openAsBlob, renameSync, rmSync } from "node:fs";
import { wrap } from "@frediverse/http";
import { diskUpload } from "@frediverse/http/upload";
import {
  type Response as ExpressResponse,
  type RequestHandler,
  Router,
} from "express";
import { z } from "zod";
import * as db from "./db.ts";
import * as mediatek from "./mediatek.ts";
import { SAFE_ID } from "./sqlite.ts";
import * as store from "./store.ts";

/** What a machine sends of a moment; its audio travels beside it as a file, `source` or `clip`. */
export const sharedMoment = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  // When its recording started; a machine older than the field sends `sessionCreatedAt` alone.
  recordedAt: z.string().nullable().optional(),
  sessionCreatedAt: z.string().nullable().optional(),
  envelope: z
    .object({ intervalMs: z.number(), samples: z.array(z.number()) })
    .nullable(),
  markers: z.array(
    z.object({ atSec: z.number(), comment: z.string(), createdAt: z.string() }),
  ),
  // Where the `source` file starts on the recording's timeline: 0 for the whole recording, the slice's start otherwise.
  sourceStartSec: z.number().min(0).optional(),
});

export type SharedMoment = z.infer<typeof sharedMoment>;

/** Malformed JSON reads as nothing, which the schema then refuses with a 400. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The person who paired the device, as `deviceGate` left them; null for an older token that names nobody. */
const personOf = (res: ExpressResponse): string | null =>
  (res.locals.syncCaller as { person?: string | null } | undefined)?.person ??
  null;

/** The name of the device that passed the gate, what a shared moment says it came from. */
const deviceOf = (res: ExpressResponse): string =>
  (res.locals.syncCaller as { device?: string | null } | undefined)?.device ||
  "a machine";

/** When its recording started, from whichever field the machine sent. */
const recordedAt = (m: SharedMoment): string =>
  m.recordedAt || m.sessionCreatedAt || "";

/** When the moment was PLAYED: its recording's start plus its offset, the name its clip is filed under. */
function playedAt(m: SharedMoment): Date | undefined {
  const at = recordedAt(m);
  const t = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(t) ? undefined : new Date(t + m.startSec * 1000);
}

/** The uploaded file's extension, which the decoder takes as a hint; a name that has none gives none. */
function extensionOf(name: string | undefined): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name ?? "")?.[1];
  return ext ? `.${ext.toLowerCase()}` : "";
}

/** The moment's clip cut here out of the machine's audio, exactly as this server cuts its own; the caller owns the file. */
async function cutFromSource(
  source: Express.Multer.File,
  m: SharedMoment,
): Promise<string> {
  const at = m.sourceStartSec ?? 0;
  const named = `${source.path}${extensionOf(source.originalname)}`;
  renameSync(source.path, named);
  source.path = named;
  return store.cutMomentClip(named, m.startSec - at, m.endSec - at);
}

/** The server's side: the person's moment ids, and the upsert of one, behind a device token (`gate`). */
export const momentDeviceRouter = (gate: RequestHandler): Router => {
  const r = Router();
  const upload = diskUpload(store.UPLOAD_DIR);
  r.use(gate);

  r.get(
    "/",
    wrap(async (_req, res) => {
      const person = personOf(res);
      if (!person) return res.json([]);
      const recs = await db.listRecords(
        "Comments",
        { OwnerId: [person] },
        {
          fields: [],
        },
      );
      res.json(recs.map((r) => r.id));
    }),
  );

  r.put(
    "/:id",
    upload.fields([
      { name: "clip", maxCount: 1 },
      { name: "source", maxCount: 1 },
    ]),
    wrap(async (req, res) => {
      const person = personOf(res);
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const source = files.source?.[0];
      const sent = files.clip?.[0];
      let cut: string | null = null;
      try {
        // A moment is somebody's: a token that names nobody cannot share one.
        if (!person)
          return res.status(403).json({
            error:
              "this machine was paired before tokens named a person: pair it again",
          });
        const id = req.params.id;
        // The id becomes a row id and a cache file's name: one plain segment.
        if (!SAFE_ID.test(id))
          return res.status(400).json({ error: "bad moment id" });
        if (!sent && !source)
          return res
            .status(400)
            .json({ error: "the moment's audio is missing" });
        const parsed = sharedMoment.safeParse(
          parseJson(String(req.body?.moment ?? "null")),
        );
        if (!parsed.success)
          return res.status(400).json({ error: parsed.error.message });
        const m = parsed.data;
        const [existing] = (
          await db.listRecords("Comments", undefined, {
            fields: ["OwnerId", "ClipPath"],
          })
        ).filter((r) => r.id === id);
        if (existing && existing.fields.OwnerId !== person)
          return res
            .status(409)
            .json({ error: "that moment id is somebody else's" });

        // A machine that cuts no clip sends the audio, and the clip is cut here.
        if (source) cut = await cutFromSource(source, m);
        const clipFile = cut ?? (sent as Express.Multer.File).path;
        const clipPath = await mediatek.pushMoment(
          await openAsBlob(clipFile),
          "webm",
          {
            at: playedAt(m),
            durationSec: m.endSec - m.startSec,
            label: m.text,
          },
        );
        const fields = {
          // The recording stays on the machine: here the moment is its clip alone.
          RecordingPath: "",
          RecordedAt: recordedAt(m),
          OwnerId: person,
          StartSec: m.startSec,
          EndSec: m.endSec,
          Text: m.text,
          Tags: m.tags.join(","),
          CreatedAt: m.createdAt,
          Validated: true,
          ClipPath: clipPath,
          Envelope: m.envelope ? JSON.stringify(m.envelope) : "",
          SharedFrom: deviceOf(res),
        };
        if (existing) {
          // Sharing again REPLACES: the old clip and the old markers go, the moment keeps its id.
          const old = String(existing.fields.ClipPath || "");
          if (old && old !== clipPath)
            await mediatek.remove(old).catch(() => {});
          const markers = await db.listRecords("Markers", { MomentId: [id] });
          await db.deleteRecords(
            "Markers",
            markers.map((x) => x.id),
          );
          await db.patchRecord("Comments", id, fields);
          store.dropClipCache(id);
        } else await db.addRecords("Comments", [{ id, ...fields }]);
        await db.addRecords(
          "Markers",
          m.markers.map((x) => ({
            MomentId: id,
            OwnerId: person,
            AtSec: x.atSec,
            Comment: x.comment,
            CreatedAt: x.createdAt,
          })),
        );
        res.json({ ok: true, replaced: Boolean(existing) });
      } finally {
        store.discardUploads([sent, source].filter((f) => f !== undefined));
        if (cut) rmSync(cut, { force: true });
      }
    }),
  );
  return r;
};
