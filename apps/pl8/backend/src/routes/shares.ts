// shares.ts — the author's half of a share: uploading one, listing what you have shared, and
// taking one back. Behind the same guard as the repositories; the PUBLIC half is publicShare.ts
// and shares nothing with this but the store. See ../../docs/shares.md.

import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { wrap } from "@frediverse/http/route";
import express, { type Request, Router, type Router as RouterT } from "express";
import { rememberIdentity, subFor } from "../projects/identities.ts";
import {
  addShare,
  blobDir,
  findShare,
  isKey,
  listShares,
  mintToken,
  revision,
  revokeShare,
} from "../shares/store.ts";

/** What `scripts/tokens.mjs` prefixes a machine-to-service token's subject with — see projects.ts. */
const SERVICE_SUB_PREFIX = "service:";

function subOf(req: Request): string {
  return (req as { user?: { sub?: string } }).user?.sub ?? "";
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
      res.json({ revision: revision(owner(req)) });
    }),
  );

  /**
   * WHOSE shares. An ACCOUNT token or a session answers by itself; a SERVICE token — which is
   * what the machine holding the project actually carries — has no person of its own and must
   * NAME one. The same trade `/ssh-key/private` documents: whoever holds a machine's token can
   * act for anyone on it. See ../../docs/sshKeyForService.md.
   */
  function owner(req: Request): string {
    const sub = subOf(req);
    const asked = typeof req.query.user === "string" ? req.query.user : "";
    return sub.startsWith(SERVICE_SUB_PREFIX) && asked ? subFor(asked) : sub;
  }

  /** Everything this person has shared, newest first. The token rides along — it IS the copy button. */
  router.get(
    "/",
    wrap((req, res) => {
      res.json({
        shares: listShares(owner(req)),
        revision: revision(owner(req)),
      });
    }),
  );

  /**
   * Open a draft: mint the secret, make its directory, and say what is expected.
   *
   * The body is the manifest `@studio/commands/share-bundle` just wrote — small JSON, well
   * inside the 8 MB `express.json` limit this service mounts globally. The AUDIO does not come
   * this way; it comes one raw PUT at a time below, because pl8 does not do multipart and a
   * 400 MB file must never be a field in a form parse (see library.ts).
   *
   * Nothing is reachable yet: `pending.json` is what the public routes read as "not live".
   */
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
      const expects = [
        m.media.mix.file,
        ...(m.media.stems ?? []).map((s) => s.file),
        ...(m.docs ?? []),
      ];
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

  /** One file of the draft. Raw, one per request — the library's own upload rule. */
  router.put(
    "/:key/file",
    express.raw({ type: "*/*", limit: "512mb" }),
    wrap((req, res) => {
      const key = req.params.key;
      const pending = isKey(key) ? pendingOf(key) : null;
      if (!pending) return res.status(404).json({ error: "no such draft" });
      if (pending.owner !== owner(req))
        return res.status(403).json({ error: "not your share" });
      const path = String(req.query.path ?? "");
      // MATCHED, never sanitised: the draft said what it would send, and anything else is not
      // part of this snapshot. That is what keeps a request from ever reaching a path here.
      if (!expected(pending, path))
        return res
          .status(400)
          .json({ error: `'${path}' is not part of this share` });
      writeFileSync(join(blobDir(key), path), req.body as Buffer);
      res.json({ ok: true });
    }),
  );

  /**
   * Go live.
   *
   * The moment `snapshot.json` exists and `pending.json` does not, the link answers — so this is
   * the one place the whole upload becomes visible, and a crashed one never does. Sizes are
   * re-measured HERE rather than trusted from the draft: what the link serves is what landed.
   */
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
