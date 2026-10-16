// liveBlobs.ts — a replica's local blob cache: the exact bytes a ref names, kept by sha256 while they are in flight.
// A capture copies a changed binary in BEFORE naming it, so the bytes an op names cannot change under it.
// It also remembers which files wait for bytes, so a restart does not read their absence as a removal.
// See ../../file-hub/docs/blobs.md.

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import type { BlobId } from "@studio/live-sync/blob";
import { writeFileAtomic } from "@studio/song/atomicWrite";

/** A copy that is a clone where the file system allows it, and a plain copy elsewhere. */
export function cloneFile(from: string, to: string): void {
  rmSync(to, { force: true });
  copyFileSync(from, to, constants.COPYFILE_FICLONE);
}

/** The sha256 and length of a file, read in chunks so a large take is never held whole. */
export function sha256File(abs: string): BlobId {
  const fd = openSync(abs, "r");
  const buf = Buffer.allocUnsafe(1 << 20);
  const sha = createHash("sha256");
  let size = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      sha.update(buf.subarray(0, n));
      size += n;
    }
  } finally {
    closeSync(fd);
  }
  return { hash: sha.digest("hex"), size };
}

export const sha256Buffer = (buf: Buffer): BlobId => ({
  hash: createHash("sha256").update(buf).digest("hex"),
  size: buf.length,
});

export class BlobCache {
  constructor(readonly dir: string) {}

  path(hash: string): string {
    return join(this.dir, hash);
  }

  has(hash: string): boolean {
    return existsSync(this.path(hash));
  }

  /** Where a download of `hash` keeps the bytes that arrived, so a failed one resumes rather than restart. */
  partial(hash: string): string {
    mkdirSync(this.dir, { recursive: true });
    return join(this.dir, `part-${hash}`);
  }

  /** A fresh file name in the cache, for a copy or a download that is not verified yet. */
  tmp(): string {
    mkdirSync(this.dir, { recursive: true });
    return join(this.dir, `tmp-${randomUUID()}`);
  }

  /** Copy `abs` in, hash the COPY and keep it under that hash; `fresh` is false when the cache held it already. */
  snapshot(abs: string): BlobId & { fresh: boolean } {
    const tmp = this.tmp();
    cloneFile(abs, tmp);
    const id = sha256File(tmp);
    return { ...id, fresh: this.keep(tmp, id.hash) };
  }

  /** Move a verified `tmp` under its hash; answers false (and drops it) when that hash was there. */
  keep(tmp: string, hash: string): boolean {
    if (this.has(hash)) {
      rmSync(tmp, { force: true });
      return false;
    }
    renameSync(tmp, this.path(hash));
    return true;
  }

  evict(hash: string): void {
    rmSync(this.path(hash), { force: true });
    rmSync(join(this.dir, `part-${hash}`), { force: true });
  }

  /** The files waiting for bytes, by workspace path, each with the ref it waits for. */
  pending(): Record<string, string> {
    try {
      return JSON.parse(
        readFileSync(join(this.dir, "pending.json"), "utf8"),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  }

  savePending(files: Record<string, string>): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileAtomic(join(this.dir, "pending.json"), JSON.stringify(files));
  }
}
