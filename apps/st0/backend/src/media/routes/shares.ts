// shares.ts — the author's half of a share: uploading one, listing what you have shared, and
// taking one back. Behind the same guard as the repositories; the PUBLIC half is publicShare.ts
// and shares nothing with this but the store. See ../../../docs/media/shares.md.

import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { wrap } from "@frediverse/http/route";
import { moveFile } from "@studio/mediatek/write";
import { type Request, Router, type Router as RouterT } from "express";
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

function subOf(req: Request): string {
  return (req as { user?: { sub?: string } }).user?.sub ?? "";
}

/** The two files the store writes itself, which no upload may name. */
const RESERVED = new Set(["pending.json", "snapshot.json"]);

/** A name the manifest may list: `audio/<name>` for the media, a bare name for a doc — never a path that climbs. */
export function shareFileOk(rel: string, audio: boolean): boolean {
  const name = audio ? rel.replace(/^audio\//, "") : rel;
  if (audio && name === rel) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !RESERVED.has(name);
}

/** A file the uploader may PUT: one of the names the draft's own manifest listed. */
const expected = (pending: { expects: string[] }, path: string): boolean =>
  pending.expects.includes(path);

function pendingOf(key: string): {
  owner: string;
  expects: string[];
  manifest: Record<string, unknown>;
} | null {
  try {
    return JSON.parse(readFileSync(join(blobDir(key), "pending.json"), "utf8"));
  } catch {
    return null;
  }
}

export function sharesRouter(): RouterT {
  const router: RouterT = Router();

  router.use((req, res, next) => {
    const sub = subOf(req);
    if (!sub) return res.status(401).json({ error: "no user on the session" });
    rememberIdentity(
      sub,
      (req as { user?: { email?: string } }).user?.email ?? null,
    );
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
    const sub = subOf(req);
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

  /** Open a draft: the manifest only, and nothing is reachable while `pending.json` is there. */
  router.post(
    "/",
    wrap((req, res) => {
      const sub = owner(req);
      if (sub.startsWith(SERVICE_SUB_PREFIX))
        return res.status(400).json({
          error: "a service token must say whose share this is (?user=)",
        });
      const body = req.body as {
        manifest?: {
          media?: { mix?: { file?: string }; stems?: { file: string }[] };
          docs?: string[];
          name?: string;
        };
        origin?: { repo: string; project: string };
      };
      const m = body?.manifest;
      if (!m?.media?.mix?.file)
        return res
          .status(400)
          .json({ error: "a share needs a manifest with a mixdown" });
      const media = [
        m.media.mix.file,
        ...(m.media.stems ?? []).map((s) => s.file),
      ];
      const docs = m.docs ?? [];
      // Every name is joined onto the share's folder by the PUT and the public reads, so each is checked here.
      const bad = [
        ...media.filter((f) => typeof f !== "string" || !shareFileOk(f, true)),
        ...docs.filter((f) => typeof f !== "string" || !shareFileOk(f, false)),
      ];
      if (bad.length)
        return res
          .status(400)
          .json({ error: `not a share file name: ${bad.join(", ")}` });
      const expects = [...media, ...docs];
      const { token, key } = mintToken();
      mkdirSync(join(blobDir(key), "audio"), { recursive: true });
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
      moveFile(uploadOf(req).file, join(blobDir(key), path));
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
      const m = pending.manifest as {
        name?: string;
        media: {
          mix: { file: string; bytes: number };
          stems: { file: string; bytes: number }[];
        };
      };
      m.media.mix.bytes = sizes.get(m.media.mix.file) ?? 0;
      for (const s of m.media.stems) s.bytes = sizes.get(s.file) ?? 0;
      const bytes = [...sizes.values()].reduce((n, b) => n + b, 0);
      writeFileSync(join(dir, "snapshot.json"), JSON.stringify(m), "utf8");
      rmSync(join(dir, "pending.json"), { force: true });
      const token = String((req.body as { token?: string })?.token ?? "");
      addShare(sub, {
        key,
        token,
        name: m.name ?? "",
        origin: (pending as { origin?: { repo: string; project: string } })
          .origin ?? {
          repo: "",
          project: "",
        },
        createdAt: new Date().toISOString(),
        bytes,
        stems: m.media.stems.length,
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
