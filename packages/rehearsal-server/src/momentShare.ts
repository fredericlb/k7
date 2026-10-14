// momentShare.ts — a paired machine shares one of its moments with its server: the clip, the span, the
// text, the markers, never the session, which stays on the machine. Sharing again replaces the server's copy.
// What reads wrong: the copy keeps the machine's moment id, which is how "shared" is told — ../docs/momentShare.md.

import { openAsBlob } from "node:fs";
import { sub, wrap } from "@frediverse/http";
import { diskUpload } from "@frediverse/http/upload";
import type { MomentPlacement } from "@studio/rehearsal-shared";
import {
  type Response as ExpressResponse,
  type RequestHandler,
  Router,
} from "express";
import { z } from "zod";
import * as db from "./db.ts";
import type * as Declared from "./index.d.ts";
import * as mediatek from "./mediatek.ts";
import * as store from "./store.ts";

/** What a machine sends of a moment; the clip travels beside it as a file. */
const sharedMoment = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  sessionCreatedAt: z.string().nullable(),
  envelope: z
    .object({ intervalMs: z.number(), samples: z.array(z.number()) })
    .nullable(),
  markers: z.array(
    z.object({ atSec: z.number(), comment: z.string(), createdAt: z.string() }),
  ),
});

type SharedMoment = z.infer<typeof sharedMoment>;

/** The person who paired the device, as `deviceGate` left them; null for an older token that names nobody. */
const personOf = (res: ExpressResponse): string | null =>
  (res.locals.syncCaller as { person?: string | null } | undefined)?.person ??
  null;

/** The name of the device that passed the gate, what a shared moment says it came from. */
const deviceOf = (res: ExpressResponse): string =>
  (res.locals.syncCaller as { device?: string | null } | undefined)?.device ||
  "a machine";

/** When the moment was PLAYED: its session's start plus its offset, the name its clip is filed under. */
function playedAt(m: SharedMoment): Date | undefined {
  const t = m.sessionCreatedAt ? Date.parse(m.sessionCreatedAt) : Number.NaN;
  return Number.isNaN(t) ? undefined : new Date(t + m.startSec * 1000);
}

/** The server's side: the person's moment ids, and the upsert of one, behind a device token (`gate`). */
export const momentDeviceRouter: typeof Declared.momentDeviceRouter = (
  gate: RequestHandler,
) => {
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
    upload.single("clip"),
    wrap(async (req, res) => {
      const person = personOf(res);
      const clip = req.file;
      try {
        // A moment is somebody's: a token that names nobody cannot share one.
        if (!person)
          return res.status(403).json({
            error:
              "this machine was paired before tokens named a person: pair it again",
          });
        if (!clip)
          return res.status(400).json({ error: "the clip is missing" });
        const parsed = sharedMoment.safeParse(
          JSON.parse(String(req.body?.moment ?? "null")),
        );
        if (!parsed.success)
          return res.status(400).json({ error: parsed.error.message });
        const m = parsed.data;
        const id = req.params.id;
        const [existing] = (
          await db.listRecords("Comments", undefined, {
            fields: ["OwnerId", "ClipPath"],
          })
        ).filter((r) => r.id === id);
        if (existing && existing.fields.OwnerId !== person)
          return res
            .status(409)
            .json({ error: "that moment id is somebody else's" });

        const clipPath = await mediatek.pushMoment(
          await openAsBlob(clip.path),
          "webm",
          {
            at: playedAt(m),
            durationSec: m.endSec - m.startSec,
            label: m.text,
          },
        );
        const fields = {
          SessionUid: "",
          OwnerId: person,
          StartSec: m.startSec,
          EndSec: m.endSec,
          Text: m.text,
          Tags: m.tags.join(","),
          CreatedAt: m.createdAt,
          Validated: true,
          ClipPath: clipPath,
          Envelope: m.envelope ? JSON.stringify(m.envelope) : "",
          SessionCreatedAt: m.sessionCreatedAt ?? "",
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
        if (clip) store.discardUploads([clip]);
      }
    }),
  );
  return r;
};

/** The machine's side: `GET /` says which of its moments the server holds, `POST /:id/share` shares one. */
export const momentShareRouter: typeof Declared.momentShareRouter = (opts) => {
  const r = Router();

  r.get(
    "/",
    wrap(async (req, res) => {
      const server = opts.server(req);
      if (!server) {
        const none: MomentPlacement = {
          paired: false,
          server: null,
          shared: [],
        };
        return res.json(none);
      }
      let theirs: string[];
      try {
        // Bounded: the moments list must not wait on a server that is away.
        const got = await fetch(`${server.base}${opts.deviceRoute}`, {
          headers: { authorization: `Bearer ${server.token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!got.ok) throw new Error(`${got.status} ${got.statusText}`);
        theirs = (await got.json()) as string[];
      } catch (e) {
        return res.status(502).json({
          error: `could not ask ${server.base} for its moments: ${(e as Error).message}`,
        });
      }
      const there = new Set(theirs);
      const mine = await store.listMoments(sub(req));
      const placement: MomentPlacement = {
        paired: true,
        server: server.base,
        shared: mine.map((m) => m.id).filter((id) => there.has(id)),
      };
      res.json(placement);
    }),
  );

  r.post(
    "/:id/share",
    wrap(async (req, res) => {
      const server = opts.server(req);
      if (!server)
        return res.status(409).json({ error: "this account is not paired" });
      const owner = sub(req);
      const id = req.params.id;
      let moment = await store.getMoment(owner, id);
      if (!moment) return res.status(404).json({ error: "no such moment" });
      // A moment with no clip of its own is cut out of its session first: the session itself never leaves.
      if (!moment.validated) {
        if (!moment.sessionUid || !moment.sessionAvailable)
          return res.status(409).json({
            error: "this moment has no clip, and its session is gone",
          });
        await store.validateMoment(moment.sessionUid, id);
        moment = await store.getMoment(owner, id);
      }
      const clip = await store.ensureMomentClipCached(owner, id);
      if (!moment || !clip)
        return res.status(409).json({ error: "this moment has no clip" });

      const body: SharedMoment = {
        startSec: moment.startSec,
        endSec: moment.endSec,
        text: moment.text,
        tags: moment.tags,
        createdAt: moment.createdAt,
        sessionCreatedAt: moment.sessionCreatedAt,
        envelope: moment.envelope ?? null,
        markers: (moment.markers ?? []).map((x) => ({
          atSec: x.atSec,
          comment: x.comment,
          createdAt: x.createdAt,
        })),
      };
      const form = new FormData();
      form.append("moment", JSON.stringify(body));
      form.append(
        "clip",
        await openAsBlob(clip.filePath, { type: clip.mime }),
        "moment.webm",
      );
      try {
        const sent = await fetch(
          `${server.base}${opts.deviceRoute}/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            headers: { authorization: `Bearer ${server.token}` },
            body: form,
            signal: AbortSignal.timeout(10 * 60_000),
          },
        );
        const answer = (await sent.json().catch(() => ({}))) as {
          error?: string;
          replaced?: boolean;
        };
        if (!sent.ok)
          return res.status(502).json({
            error: answer.error ?? `${sent.status} ${sent.statusText}`,
          });
        res.json({ ok: true, replaced: Boolean(answer.replaced) });
      } catch (e) {
        res.status(502).json({ error: (e as Error).message });
      }
    }),
  );

  return r;
};
