// shares.ts — the author's half of a share: uploading one (a checkpoint, compiled), listing what you have shared,
// and taking one back. Behind the same guard as the repositories; the PUBLIC half is publicShare.ts
// and shares nothing with this but the store. See ../../../docs/media/shares.md.

import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { wrap } from "@frediverse/http/route";
import { moveFile } from "@studio/mediatek/write";
import { SHARE_SCHEMA, type ShareManifest } from "@studio/web-protocol";
import { plainSegments } from "@studio/web-protocol/paths";
import { type Request, Router, type Router as RouterT } from "express";
import { emailOf, subOf } from "../../who.ts";
import { rememberIdentity, subFor } from "../projects/identities.ts";
import {
  commentsStamp,
  countsFor,
  isState,
  listComments,
  setCommentState,
} from "../shares/comments.ts";
import {
  addShare,
  blobDir,
  findShare,
  isKey,
  listShares,
  mintToken,
  revision,
  revokeShare,
  sharesDir,
} from "../shares/store.ts";
import { rawToDisk, uploadOf } from "../upload.ts";

/** What `scripts/tokens.mjs` prefixes a machine-to-service token's subject with — see projects.ts. */
const SERVICE_SUB_PREFIX = "service:";

/** The two files the store writes itself, which no upload may name. */
const RESERVED = new Set(["pending.json", "snapshot.json"]);

/** A path the manifest may list: relative, slash-separated, never climbing, never one of the store's own files. */
function shareFileOk(rel: unknown): rel is string {
  if (typeof rel !== "string" || !rel || rel.length > 1024) return false;
  if (rel.includes("\\") || rel.includes("\u0000") || rel.startsWith("/"))
    return false;
  if (!plainSegments(rel)) return false;
  return !RESERVED.has(rel);
}

/** A file the uploader may PUT: one of the names the draft's own manifest listed. */
const expected = (pending: { expects: string[] }, path: string): boolean =>
  pending.expects.includes(path);

function pendingOf(key: string): {
  owner: string;
  expects: string[];
  manifest: ShareManifest;
  origin?: { repo: string; project: string } | null;
} | null {
  try {
    return JSON.parse(readFileSync(join(blobDir(key), "pending.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Whether this server can play a share now — its engine, as the player finds it (player.ts). */
export type PlayerCheck = () => { available: boolean; why?: string };

export function sharesRouter(player: PlayerCheck): RouterT {
  const router: RouterT = Router();

  router.use((req, res, next) => {
    const sub = subOf(req);
    if (!sub) return res.status(401).json({ error: "no user on the session" });
    rememberIdentity(sub, emailOf(req));
    next();
  });

  /** This user's change token — folded into the Projets poll rather than given one of its own. */
  router.get(
    "/revision",
    wrap((req, res) => {
      res.json({ revision: stamp(owner(req)) });
    }),
  );

  /** The rows AND the comments in one token: a resolved comment must move the badge on the next poll. */
  function stamp(sub: string): string {
    const keys = listShares(sub).map((s) => s.key);
    return `${revision(sub)}|${commentsStamp(keys)}`;
  }

  /** WHOSE shares: a SERVICE token has no person and must NAME one — ../../../docs/media/sshKeyForService.md. */
  function owner(req: Request): string {
    const sub = subOf(req) ?? "";
    const asked = typeof req.query.user === "string" ? req.query.user : "";
    return sub.startsWith(SERVICE_SUB_PREFIX) && asked ? subFor(asked) : sub;
  }

  /** Everything this person has shared, newest first. The token rides along — it IS the copy button. */
  router.get(
    "/",
    wrap((req, res) => {
      const sub = owner(req);
      // Counted on the way OUT and never stored on the row: a saved count is a count that goes stale.
      res.json({
        shares: listShares(sub).map((s) => ({
          ...s,
          comments: countsFor(s.key),
        })),
        revision: stamp(sub),
      });
    }),
  );

  /** Whether a share made now would play: the file service asks before it does any work. */
  router.get(
    "/player",
    wrap((_req, res) => {
      res.json(player());
    }),
  );

  /** Open a draft: the manifest only, and nothing is reachable while `pending.json` is there. */
  router.post(
    "/",
    wrap((req, res) => {
      const sub = owner(req);
      if (sub.startsWith(SERVICE_SUB_PREFIX))
        return res.status(400).json({
          error: "a service token must say whose share this is (?user=)",
        });
      const can = player();
      if (!can.available)
        return res.status(503).json({
          error: can.why ?? "this server has no engine to play shares on",
        });
      const body = req.body as {
        manifest?: Partial<ShareManifest>;
        origin?: { repo: string; project: string };
      };
      const m = body?.manifest;
      if (m?.schema !== SHARE_SCHEMA || !m.checkpoint || !m.engineDoc)
        return res
          .status(400)
          .json({ error: `a share needs a schema-${SHARE_SCHEMA} manifest` });
      const docs = [...(m.docs ?? []), m.engineDoc];
      const files = (m.files ?? []).map((f) => f?.path);
      // Every name is joined onto the share's folder by the PUT and the public reads, so each is checked here.
      const bad = [
        ...docs.filter((f) => !shareFileOk(f) || f.includes("/")),
        ...files.filter((f) => !shareFileOk(f)),
      ];
      if (bad.length)
        return res
          .status(400)
          .json({ error: `not a share file name: ${bad.join(", ")}` });
      const expects = [...docs, ...files] as string[];
      const { token, key } = mintToken();
      mkdirSync(blobDir(key), { recursive: true });
      writeFileSync(
        join(blobDir(key), "pending.json"),
        JSON.stringify({
          owner: sub,
          expects,
          manifest: m,
          origin: body.origin ?? null,
        }),
        "utf8",
      );
      res.json({ key, token, expects });
    }),
  );

  /** One file of the draft. Raw, one per request, streamed to disk — the library's own upload rule. */
  router.put(
    "/:key/file",
    rawToDisk(() => join(sharesDir(), "uploads")),
    wrap((req, res) => {
      const key = req.params.key;
      const pending = isKey(key) ? pendingOf(key) : null;
      if (!pending) return res.status(404).json({ error: "no such draft" });
      if (pending.owner !== owner(req))
        return res.status(403).json({ error: "not your share" });
      const path = String(req.query.path ?? "");
      // MATCHED, never sanitised: the draft said what it would send, so nothing reaches a path.
      if (!expected(pending, path))
        return res
          .status(400)
          .json({ error: `'${path}' is not part of this share` });
      const to = join(blobDir(key), path);
      mkdirSync(dirname(to), { recursive: true });
      moveFile(uploadOf(req).file, to);
      res.json({ ok: true });
    }),
  );

  /** Go live, in one step, and the sizes are re-MEASURED: what the link serves is what landed. */
  router.post(
    "/:key/finish",
    wrap((req, res) => {
      const key = req.params.key;
      const pending = isKey(key) ? pendingOf(key) : null;
      if (!pending) return res.status(404).json({ error: "no such draft" });
      const sub = owner(req);
      if (pending.owner !== sub)
        return res.status(403).json({ error: "not your share" });
      const dir = blobDir(key);
      const sizes = new Map<string, number>();
      for (const rel of pending.expects) {
        try {
          sizes.set(rel, statSync(join(dir, rel)).size);
        } catch {
          return res.status(400).json({ error: `'${rel}' never arrived` });
        }
      }
      const m = pending.manifest;
      m.files = (m.files ?? []).map((f) => ({
        ...f,
        bytes: sizes.get(f.path) ?? 0,
      }));
      const bytes = [...sizes.values()].reduce((n, b) => n + b, 0);
      m.bytes = bytes;
      writeFileSync(join(dir, "snapshot.json"), JSON.stringify(m), "utf8");
      rmSync(join(dir, "pending.json"), { force: true });
      const token = String((req.body as { token?: string })?.token ?? "");
      addShare(sub, {
        key,
        token,
        name: m.name ?? "",
        origin: pending.origin ?? { repo: "", project: "" },
        createdAt: new Date().toISOString(),
        bytes,
        checkpoint: { seq: m.checkpoint.seq, name: m.checkpoint.name },
      });
      res.json({ ok: true, key, bytes });
    }),
  );

  /** What was written on one snapshot — the author's view, which is the only one with three tabs. */
  router.get(
    "/:key/comments",
    wrap((req, res) => {
      const sub = owner(req);
      if (!isKey(req.params.key) || !findShare(sub, req.params.key))
        return res.status(404).json({ error: "no such share" });
      // Revoked shares keep theirs: the bytes were the cost, and the feedback is what the author kept it for.
      res.json({ comments: listComments(req.params.key) });
    }),
  );

  /** Resolve one, ignore it, or put it back — the three states, and no fourth verb to delete. */
  router.patch(
    "/:key/comments/:id",
    wrap((req, res) => {
      const sub = owner(req);
      if (!isKey(req.params.key) || !findShare(sub, req.params.key))
        return res.status(404).json({ error: "no such share" });
      const state = String((req.body as { state?: string })?.state ?? "");
      if (!isState(state))
        return res.status(400).json({ error: `'${state}' is not a state` });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || !setCommentState(req.params.key, id, state))
        return res.status(404).json({ error: "no such comment" });
      res.json({ ok: true });
    }),
  );

  /** Take it back: the bytes go, the row stays dated. Idempotent — a second click is not an error. */
  router.delete(
    "/:key",
    wrap((req, res) => {
      const sub = owner(req);
      if (!isKey(req.params.key) || !findShare(sub, req.params.key))
        return res.status(404).json({ error: "no such share" });
      revokeShare(sub, req.params.key);
      res.json({ ok: true });
    }),
  );

  return router;
}
