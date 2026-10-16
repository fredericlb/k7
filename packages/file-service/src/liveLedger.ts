// liveLedger.ts — what a capture's ledger records of one file, and the index that spares re-hashing binaries at start.
// The index maps a path and its stamp (size + mtimeMs) to the blob it held; a stamp that has not settled is never
// kept, since a same-size rewrite inside one timestamp tick keeps it. See ../docs/liveCapture.md.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type BlobId, parseBlobRef } from "@studio/live-sync/blob";
import { SETTLE_MS } from "@studio/song/moduleCache";
import { isDocFile } from "@studio/song-schema/docExt";

/** What the ledger knows of one file: its stamp, the `textHash` of its text or ref, the text of a YAML file. */
export interface Known {
  stamp: string;
  hash: string;
  text: string | null;
  /** An opaque file's blob ref. */
  ref?: string;
  /** Known by its ref but not on disk yet: its bytes are being fetched, and its absence is no removal. */
  pending?: true;
}

/** A text file past this travels as an opaque file, like audio. */
export const TEXT_CEILING = 5 * 1024 * 1024;

/** A file whose text the ledger keeps, to diff its next change into path ops: YAML and k7x. */
export const keepsText = (rel: string): boolean => isDocFile(rel);

/** Git's own test: a NUL byte in the first 8000 bytes makes a file binary, whatever its extension. */
export const looksBinary = (buf: Buffer): boolean =>
  buf.subarray(0, 8000).includes(0);

export const stampOf = (size: number, mtimeMs: number): string =>
  `${size}:${mtimeMs}`;

interface Indexed {
  stamp: string;
  hash: string;
  size: number;
}

/** The binaries' hashes by path and stamp, kept across restarts in one JSON file written atomically. */
export class BlobIndex {
  private entries: Record<string, Indexed> = {};
  private written = "";

  constructor(private readonly file: string) {
    try {
      this.written = readFileSync(file, "utf8");
      this.entries = JSON.parse(this.written).files ?? {};
    } catch {
      // No index yet, or a torn one: every binary is hashed once more.
    }
  }

  /** The blob `rel` held when it last had this stamp, or null. */
  get(rel: string, stamp: string): BlobId | null {
    const e = this.entries[rel];
    return e && e.stamp === stamp ? { hash: e.hash, size: e.size } : null;
  }

  /** Rewrite the index from the ledger's opaque files whose stamp has settled; nothing is written when nothing moved. */
  save(ledger: Map<string, Known>, now = Date.now()): void {
    const files: Record<string, Indexed> = {};
    for (const [rel, k] of ledger) {
      const blob = k.pending ? null : parseBlobRef(k.ref ?? null);
      const mtime = Number(k.stamp.split(":")[1]);
      if (blob && k.stamp && now - mtime > SETTLE_MS)
        files[rel] = { stamp: k.stamp, ...blob };
    }
    const text = JSON.stringify({ files });
    if (text === this.written) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, text);
      renameSync(`${this.file}.tmp`, this.file);
      this.written = text;
      this.entries = files;
    } catch {
      // A state folder that cannot be written costs a re-hash at the next start, nothing more.
    }
  }
}
