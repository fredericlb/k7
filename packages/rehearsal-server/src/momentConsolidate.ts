// momentConsolidate.ts — the machine's side of a moment that goes to a server: which of its moments the active
// server holds, that server and whether it answers, and the send itself.
// What reads wrong: a local instance cuts no clip; it sends the recording's audio, and the server cuts — ../docs/momentShare.md.

import { randomUUID } from "node:crypto";
import { openAsBlob, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { sub, wrap } from "@frediverse/http";
import type {
  ConsolidationServer,
  ConsolidationServers,
  MomentPlacement,
} from "@studio/rehearsal-shared";
import express, { type Request, Router } from "express";
import { env } from "./env.ts";
import type { SharedMoment } from "./momentShare.ts";
import type { PairedServer, ServerOf } from "./publications.ts";
import * as store from "./store.ts";
import { sliceWav } from "./wavSlice.ts";

/** The account's active server, with the token to call it through. */
export interface LinkedServer extends PairedServer {
  id: string;
  origin: string;
  as: string;
}

/** A whole recording can be hours: its upload is given the time a slow uplink needs. */
const SEND_TIMEOUT_MS = 60 * 60_000;

/** What goes up beside the moment: a file, where it starts on the recording, and what the form names it. */
interface Audio {
  path: string;
  field: "source" | "clip";
  name: string;
  sourceStartSec?: number;
  /** A slice made for this send, removed once it is sent. */
  temporary: boolean;
}

/** The moment's audio for the server: its span of a WAV, else its whole recording, else a clip cut here before. */
async function audioOf(
  owner: string,
  id: string,
  moment: { startSec: number; endSec: number; validated: boolean },
): Promise<Audio | null> {
  const src = await store.momentSource(owner, id);
  if (src) {
    const slice = join(store.UPLOAD_DIR, `tmp-slice-${randomUUID()}.wav`);
    const cut = await sliceWav(
      src.filePath,
      moment.startSec,
      moment.endSec,
      slice,
    ).catch(() => null);
    if (cut)
      return {
        path: slice,
        field: "source",
        name: "moment.wav",
        sourceStartSec: cut.startSec,
        temporary: true,
      };
    rmSync(slice, { force: true });
    const ext = extname(src.filePath) || ".webm";
    return {
      path: src.filePath,
      field: "source",
      name: `recording${ext}`,
      sourceStartSec: 0,
      temporary: false,
    };
  }
  // Its recording is gone: a clip cut on this machine before is all there is to send.
  const clip = moment.validated
    ? await store.ensureMomentClipCached(owner, id)
    : null;
  return clip
    ? {
        path: clip.filePath,
        field: "clip",
        name: "moment.webm",
        temporary: false,
      }
    : null;
}

/** `GET /` places the moments on the active server, `GET /servers` says it and whether it answers, `POST /:id/consolidate` sends one. */
export const momentShareRouter = (opts: {
  /** Where `momentDeviceRouter` is mounted on the server. */
  deviceRoute: string;
  server: ServerOf;
  /** The request's account's active server; none on a server. */
  active?: (req: Request) => LinkedServer | null;
  /** Whether a server answers right now, asked with a short timeout and remembered briefly. */
  reach?: (server: PairedServer) => Promise<boolean>;
  /** Whether this instance's moments are consolidated on a server; a local instance's are. */
  serverOnly?: boolean;
}): Router => {
  const r = Router();
  r.use(express.json());
  const active = opts.active ?? (() => null);
  const reach = opts.reach ?? (async () => true);
  const serverOnly = opts.serverOnly ?? env.instance === "local";

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

  r.get(
    "/servers",
    wrap(async (req, res) => {
      const l = serverOnly ? active(req) : null;
      const server: ConsolidationServer | null = l
        ? {
            id: l.id,
            origin: l.origin,
            as: l.as,
            online: await reach(l).catch(() => false),
          }
        : null;
      const answer: ConsolidationServers = { serverOnly, server };
      res.json(answer);
    }),
  );

  r.post(
    "/:id/consolidate",
    wrap(async (req, res) => {
      if (!serverOnly)
        return res.status(409).json({
          error: "this server consolidates its moments itself",
        });
      const linkId = String(req.body?.link ?? "");
      const link = active(req);
      if (!link || link.id !== linkId)
        return res
          .status(404)
          .json({ error: "that server is not this account's active one" });
      const owner = sub(req);
      const id = req.params.id;
      const moment = await store.getMoment(owner, id);
      if (!moment) return res.status(404).json({ error: "no such moment" });
      const audio = await audioOf(owner, id, moment);
      if (!audio)
        return res.status(409).json({
          error:
            "this moment's recording is gone and it has no clip: there is nothing to send",
        });

      const body: SharedMoment = {
        startSec: moment.startSec,
        endSec: moment.endSec,
        text: moment.text,
        tags: moment.tags,
        createdAt: moment.createdAt,
        recordedAt: moment.recordedAt,
        // What a server older than `recordedAt` requires.
        sessionCreatedAt: moment.recordedAt,
        envelope: moment.envelope ?? null,
        markers: (moment.markers ?? []).map((x) => ({
          atSec: x.atSec,
          comment: x.comment,
          createdAt: x.createdAt,
        })),
        ...(audio.sourceStartSec !== undefined
          ? { sourceStartSec: audio.sourceStartSec }
          : {}),
      };
      const host = new URL(link.origin || link.base).host;
      try {
        const form = new FormData();
        form.append("moment", JSON.stringify(body));
        form.append(audio.field, await openAsBlob(audio.path), audio.name);
        const sent = await fetch(
          `${link.base}${opts.deviceRoute}/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            headers: { authorization: `Bearer ${link.token}` },
            body: form,
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          },
        );
        const answer = (await sent.json().catch(() => ({}))) as {
          error?: string;
          replaced?: boolean;
        };
        if (!sent.ok)
          return res.status(502).json({
            error: `${host} refused the moment: ${answer.error ?? `${sent.status} ${sent.statusText}`}`,
          });
        const consolidations = store.noteConsolidation(owner, id, {
          link: link.id,
          origin: link.origin || link.base,
          as: link.as,
          at: new Date().toISOString(),
        });
        res.json({
          ok: true,
          replaced: Boolean(answer.replaced),
          consolidations,
        });
      } catch (e) {
        res.status(502).json({
          error: `could not send the moment to ${host}: ${(e as Error).message}`,
        });
      } finally {
        if (audio.temporary) rmSync(audio.path, { force: true });
      }
    }),
  );

  return r;
};
