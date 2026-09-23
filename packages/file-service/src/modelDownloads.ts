// modelDownloads.ts — fetching a model a module names into this machine's cache (`<state>/models`),
// from the URL its `model_url` gives. A job, polled: the one model st0 ships a chain for is 166 MB,
// and a request held open that long is one a proxy closes first.
//
// The URL is never the caller's to give. Every route here names a MODULE (a project node, or a chain's
// steps) and the URL is read off that module — so a page cannot make this machine fetch an arbitrary
// address, and where a file lands is decided by the module's authored name, confined to the cache.
// See packages/song/docs/moduleAssets.md.

import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { modelCachePath } from "@studio/song/modelCache";
import { moduleFoldersMoved } from "./moduleWatch.ts";

export interface ModelDownload {
  id: string;
  /** The model's file name, as the module authored it. */
  file: string;
  url: string;
  /** Bytes written so far, and the size the server announced (null when it did not). */
  received: number;
  total: number | null;
  done: boolean;
  error: string | null;
}

const jobs = new Map<string, ModelDownload>();
/** One download per FILE at a time: two chains naming the same model share the job rather than race to write it. */
const byFile = new Map<string, string>();

/** Finished jobs are kept this long for a poll to read, then forgotten. */
const KEEP_MS = 10 * 60 * 1000;

export function modelDownload(id: string): ModelDownload | null {
  return jobs.get(id) ?? null;
}

/**
 * Start fetching `file` from `url` into the cache, or answer the job already doing it. A file already
 * there is a job that is DONE at once — asking twice is harmless. Written to `<file>.part` and renamed
 * only when complete, so a model the loader finds is never half a model.
 */
export function startModelDownload(file: string, url: string): ModelDownload {
  const running = byFile.get(file);
  const existing = running ? jobs.get(running) : undefined;
  if (existing && !existing.done) return existing;

  const dest = modelCachePath(file);
  const job: ModelDownload = {
    id: randomUUID(),
    file,
    url,
    received: 0,
    total: null,
    done: false,
    error: null,
  };
  jobs.set(job.id, job);
  byFile.set(file, job.id);
  const finish = (error: string | null) => {
    job.done = true;
    job.error = error;
    setTimeout(() => {
      jobs.delete(job.id);
      if (byFile.get(file) === job.id) byFile.delete(file);
    }, KEEP_MS).unref();
  };

  if (!dest) {
    finish(`'${file}' is not a name a model can have in the cache`);
    return job;
  }
  if (!/^https?:\/\//i.test(url)) {
    finish(`'${url}' is not an http(s) URL`);
    return job;
  }
  if (existsSync(dest)) {
    finish(null);
    return job;
  }

  void (async () => {
    const part = `${dest}.part`;
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok || !res.body)
        throw new Error(`${url} answered ${res.status}`);
      // The announced size is the ENCODED one: fetch decompresses, so a gzipped body is counted in other bytes.
      const size = Number(res.headers.get("content-length"));
      job.total =
        !res.headers.get("content-encoding") &&
        Number.isFinite(size) &&
        size > 0
          ? size
          : null;
      mkdirSync(dirname(dest), { recursive: true });
      const body = Readable.fromWeb(res.body as unknown as WebReadableStream);
      body.on("data", (chunk: Buffer) => {
        job.received += chunk.length;
      });
      await pipeline(body, createWriteStream(part));
      // A short body is a failed download, not a small model: the loader would take it for the real one.
      if (job.total !== null && job.received !== job.total)
        throw new Error(
          `the download stopped at ${job.received} of ${job.total} bytes`,
        );
      renameSync(part, dest);
      // What a module's `onnx:` resolves to has just changed, in no folder the watch covers.
      moduleFoldersMoved();
      finish(null);
    } catch (e) {
      rmSync(part, { force: true });
      finish(`could not download ${file}: ${(e as Error).message}`);
    }
  })();
  return job;
}
