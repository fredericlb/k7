// blobStore.ts — the content-addressed store a binary file's bytes travel through, beside the relay:
// an op carries only a blob's ref, and each replica fetches the bytes it lacks from here.
// A PUT is verified against its hash before it lands, so a name always means its bytes. A GET honours
// Range and a PUT resumes from its kept partial. `/lib/<hash>` reads the libraries' store, which every
// account follows; only the libraries' replica writes it. See docs/blobs.md.

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  PARTIAL_LENGTH_HEADER,
  SHARED_STORE,
} from "@studio/file-service/src/liveBlobTransfer.ts";
import { isBlobHash } from "@studio/live-sync/blob";
import { type Request, type Response, Router } from "express";
import { sweepBlobs } from "./blobSweep.ts";
import { LIBRARIES_ACCOUNT } from "./libraryRelay.ts";
import { syncCredential } from "./roomsRoute.ts";

/** Generous: a long multitrack take; the body is streamed, never held. */
const MAX_BLOB = 2 * 1024 * 1024 * 1024;
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
/** An account's first sweep in this process waits a little, so a start is not a burst of reads. */
const FIRST_SWEEP_MS = 60_000;

export interface BlobStoreOptions {
  /** The account folder an account's blobs are kept under. */
  accountDir: (slug: string) => string;
  /** The account a caller proves, by a device token or a secret; null when it proves none. */
  accountOf: (cred: {
    secret?: string;
    token?: string;
  }) => Promise<string | null>;
  /** The account whose store every caller may READ at `/lib/<hash>`: the libraries'. */
  sharedAccount?: string;
  /** How often each account's store is swept of orphans (docs/blobs.md); 0 never sweeps. */
  sweepEveryMs?: number;
  /** Tests only: the largest body accepted. */
  maxBytes?: number;
  log?: (msg: string) => void;
}

/** An account's blobs: a dot-folder of its own, since every folder under `.sync-relay` is listed as a room. */
export const blobsDir = (accountDir: string): string =>
  join(accountDir, ".sync-blobs");

export const blobFile = (dir: string, hash: string): string =>
  join(dir, hash.slice(0, 2), hash);

const partialFile = (dir: string, hash: string): string =>
  join(dir, "partial", hash);

/** A blob asked for is young again, so a sweep never takes one a batch on its way is about to name. */
function touch(file: string): void {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch {
    // Gone meanwhile: the caller answers from what it already read.
  }
}

/** One `bytes=` range of a file of `size` bytes: null to send it whole, "none" when nothing of it is asked for. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "none" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    return n === 0 || size === 0
      ? "none"
      : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "none";
  return end < start ? null : { start, end };
}

const offsetOf = (v: unknown): number | null => {
  if (v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function blobsRouter(opts: BlobStoreOptions): Router {
  const max = opts.maxBytes ?? MAX_BLOB;
  const shared = opts.sharedAccount ?? LIBRARIES_ACCOUNT;
  const every = opts.sweepEveryMs ?? SWEEP_EVERY_MS;
  const log = opts.log ?? ((m: string) => console.log(`blobs | ${m}`));
  const r = Router();
  /** Partials being written: one upload of a hash at a time. */
  const writing = new Set<string>();
  /** The account folders this process has served, swept daily; one that is never used gains no orphan. */
  const accounts = new Set<string>();
  const sweeping = new Set<string>();

  const sweep = (accountDir: string): void => {
    if (sweeping.has(accountDir)) return;
    sweeping.add(accountDir);
    void sweepBlobs(blobsDir(accountDir), accountDir)
      .then((gone) => {
        if (gone.length)
          log(`${gone.length} orphan blob(s) removed from ${accountDir}`);
      })
      .catch((e: Error) => log(`sweep of ${accountDir}: ${e.message}`))
      .finally(() => sweeping.delete(accountDir));
  };
  if (every > 0)
    setInterval(() => {
      for (const d of accounts) sweep(d);
    }, every).unref();

  /** The store the request names and the blob's paths, or null once the request is answered with its refusal. */
  const locate = async (
    req: Request,
    res: Response,
    inShared: boolean,
    write: boolean,
  ): Promise<{
    dir: string;
    file: string;
    part: string;
    hash: string;
  } | null> => {
    const caller = await opts.accountOf(syncCredential(req));
    if (!caller) {
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
    if (inShared && write && caller !== shared) {
      res
        .status(403)
        .json({ error: "only the libraries' replica writes their store" });
      return null;
    }
    const accountDir = opts.accountDir(inShared ? shared : caller);
    if (every > 0 && !accounts.has(accountDir)) {
      accounts.add(accountDir);
      setTimeout(() => sweep(accountDir), FIRST_SWEEP_MS).unref();
    }
    const dir = blobsDir(accountDir);
    return {
      dir,
      file: blobFile(dir, hash),
      part: partialFile(dir, hash),
      hash,
    };
  };

  const head = (inShared: boolean) => (req: Request, res: Response) => {
    void locate(req, res, inShared, false).then((at) => {
      if (!at) return;
      if (existsSync(at.file)) {
        touch(at.file);
        return void res
          .set("content-length", String(statSync(at.file).size))
          .end();
      }
      if (existsSync(at.part))
        res.set(PARTIAL_LENGTH_HEADER, String(statSync(at.part).size));
      res.status(404).end();
    });
  };

  const get = (inShared: boolean) => (req: Request, res: Response) => {
    void locate(req, res, inShared, false).then((at) => {
      if (!at) return;
      if (!existsSync(at.file))
        return void res.status(404).json({ error: "no such blob" });
      const size = statSync(at.file).size;
      res.set({
        "content-type": "application/octet-stream",
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=31536000, immutable",
      });
      const range = parseRange(req.headers.range, size);
      if (range === "none")
        return void res
          .status(416)
          .set("content-range", `bytes */${size}`)
          .end();
      const stream = range
        ? createReadStream(at.file, range)
        : createReadStream(at.file);
      if (range)
        res.status(206).set({
          "content-range": `bytes ${range.start}-${range.end}/${size}`,
          "content-length": String(range.end - range.start + 1),
        });
      else res.set("content-length", String(size));
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    });
  };

  const put = (inShared: boolean) => (req: Request, res: Response) => {
    void locate(req, res, inShared, true).then(async (at) => {
      if (!at) return;
      const offset = offsetOf(req.query.offset);
      const refuse = (status: number, error: string, kept?: number) => {
        req.resume();
        if (kept !== undefined) res.set(PARTIAL_LENGTH_HEADER, String(kept));
        res.status(status).json({ error });
      };
      if (offset === null) return refuse(400, "offset must be a byte count");
      if (offset + Number(req.headers["content-length"] ?? 0) > max)
        return refuse(413, "blob too large");
      if (existsSync(at.file)) {
        // Content-addressed: the bytes already here ARE these bytes.
        touch(at.file);
        req.resume();
        req.on("end", () => res.json({ stored: false }));
        return;
      }
      if (writing.has(at.part))
        return refuse(409, "an upload of this blob is already running");
      const kept = existsSync(at.part) ? statSync(at.part).size : 0;
      if (offset > kept)
        return refuse(409, "resume from the bytes the store kept", kept);
      writing.add(at.part);
      try {
        await receive(req, res, at, offset, kept);
      } finally {
        writing.delete(at.part);
      }
    });
  };

  /** Append the body to the partial from `offset`, then keep it under its hash if the whole is the one named. */
  const receive = async (
    req: Request,
    res: Response,
    at: { file: string; part: string; hash: string },
    offset: number,
    kept: number,
  ): Promise<void> => {
    mkdirSync(dirname(at.part), { recursive: true });
    // A resume from short of what is kept drops the bytes past its offset.
    if (kept > offset) truncateSync(at.part, offset);
    const sha = createHash("sha256");
    if (offset > 0)
      for await (const chunk of createReadStream(at.part, { end: offset - 1 }))
        sha.update(chunk as Buffer);
    let size = offset;
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        if (size > max) return done(new Error("too large"));
        sha.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        req,
        count,
        createWriteStream(at.part, { flags: offset > 0 ? "a" : "w" }),
      );
    } catch {
      // A body cut short leaves its bytes in the partial, for the next PUT to resume from.
      if (size > max) rmSync(at.part, { force: true });
      if (!res.headersSent) {
        if (size <= max && existsSync(at.part))
          res.set(PARTIAL_LENGTH_HEADER, String(statSync(at.part).size));
        res
          .status(size > max ? 413 : 400)
          .json({ error: "the upload did not complete" });
      }
      return;
    }
    if (sha.digest("hex") !== at.hash) {
      rmSync(at.part, { force: true });
      return void res
        .status(400)
        .json({ error: "the bytes do not match their hash" });
    }
    mkdirSync(dirname(at.file), { recursive: true });
    renameSync(at.part, at.file);
    res.status(201).json({ stored: true, size });
  };

  r.head(`/${SHARED_STORE}/:hash`, head(true));
  r.get(`/${SHARED_STORE}/:hash`, get(true));
  r.put(`/${SHARED_STORE}/:hash`, put(true));
  r.head("/:hash", head(false));
  r.get("/:hash", get(false));
  r.put("/:hash", put(false));
  return r;
}
