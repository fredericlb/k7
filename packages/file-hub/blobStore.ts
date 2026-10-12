// blobStore.ts — the content-addressed store a binary file's bytes travel through, beside the relay:
// an op carries only a blob's ref, and each replica fetches the bytes it lacks from here.
// A PUT is verified against its hash before it lands, so a name always means its bytes. See docs/blobs.md.

import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isBlobHash } from "@studio/live-sync/blob";
import { type Request, type Response, Router } from "express";
import { syncCredential } from "./roomsRoute.ts";

/** Generous: a long multitrack take; the body is streamed, never held. */
const MAX_BLOB = 2 * 1024 * 1024 * 1024;

export interface BlobStoreOptions {
  /** The account folder an account's blobs are kept under. */
  accountDir: (slug: string) => string;
  /** The account a caller proves, by a device token or a secret; null when it proves none. */
  accountOf: (cred: {
    secret?: string;
    token?: string;
  }) => Promise<string | null>;
  /** Tests only: the largest body accepted. */
  maxBytes?: number;
}

/** An account's blobs: a dot-folder of its own, since every folder under `.sync-relay` is listed as a room. */
export const blobsDir = (accountDir: string): string =>
  join(accountDir, ".sync-blobs");

const blobFile = (dir: string, hash: string): string =>
  join(dir, hash.slice(0, 2), hash);

export function blobsRouter(opts: BlobStoreOptions): Router {
  const max = opts.maxBytes ?? MAX_BLOB;
  const r = Router();

  /** The caller's blob folder and the blob's path, or null once the request is answered with its refusal. */
  const locate = async (
    req: Request,
    res: Response,
  ): Promise<{ dir: string; file: string; hash: string } | null> => {
    const slug = await opts.accountOf(syncCredential(req));
    if (!slug) {
      res
        .status(401)
        .json({ error: "no device token or hub secret this hub knows" });
      return null;
    }
    const hash = String(req.params.hash);
    if (!isBlobHash(hash)) {
      res.status(400).json({ error: "a blob is named by its sha256, in hex" });
      return null;
    }
    const dir = blobsDir(opts.accountDir(slug));
    return { dir, file: blobFile(dir, hash), hash };
  };

  r.head("/:hash", (req, res) => {
    void locate(req, res).then((at) => {
      if (!at) return;
      if (!existsSync(at.file)) return void res.status(404).end();
      res.set("content-length", String(statSync(at.file).size)).end();
    });
  });

  r.get("/:hash", (req, res) => {
    void locate(req, res).then((at) => {
      if (!at) return;
      if (!existsSync(at.file))
        return void res.status(404).json({ error: "no such blob" });
      res.set({
        "content-type": "application/octet-stream",
        "content-length": String(statSync(at.file).size),
        "cache-control": "private, max-age=31536000, immutable",
      });
      createReadStream(at.file).pipe(res);
    });
  });

  r.put("/:hash", (req, res) => {
    void locate(req, res).then(async (at) => {
      if (!at) return;
      if (Number(req.headers["content-length"] ?? 0) > max)
        return void res.status(413).json({ error: "blob too large" });
      if (existsSync(at.file)) {
        // Content-addressed: the bytes already here ARE these bytes.
        req.resume();
        req.on("end", () => res.json({ stored: false }));
        return;
      }
      const tmpDir = join(at.dir, "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const tmp = join(tmpDir, randomUUID());
      const sha = createHash("sha256");
      let size = 0;
      const count = new Transform({
        transform(chunk: Buffer, _enc, done) {
          size += chunk.length;
          if (size > max) return done(new Error("too large"));
          sha.update(chunk);
          done(null, chunk);
        },
      });
      try {
        await pipeline(req, count, createWriteStream(tmp));
      } catch {
        rmSync(tmp, { force: true });
        if (!res.headersSent)
          res
            .status(size > max ? 413 : 400)
            .json({ error: "the upload did not complete" });
        return;
      }
      if (sha.digest("hex") !== at.hash) {
        rmSync(tmp, { force: true });
        return void res
          .status(400)
          .json({ error: "the bytes do not match their hash" });
      }
      mkdirSync(join(at.dir, at.hash.slice(0, 2)), { recursive: true });
      renameSync(tmp, at.file);
      res.status(201).json({ stored: true, size });
    });
  });

  return r;
}
