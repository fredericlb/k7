// liveLedger.ts — what a capture's ledger records of one file, and the index that spares re-reading files at start.
// The index maps a path and its stamp (size + mtimeMs) to the blob it held, or to the hash of the text it held; a stamp
// that has not settled is never kept, since a same-size rewrite inside one timestamp tick keeps it. See ../docs/liveCapture.md.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type BlobId, parseBlobRef } from "@studio/live-sync/blob";
import { SETTLE_MS } from "@studio/song/moduleCache";
import { isDocFile } from "@studio/song-schema/docExt";

/** What the ledger knows of one file: its stamp, the `textHash` of its text or ref, the text of a k7x file. */
export interface Known {
  stamp: string;
  hash: string;
  text: string | null;
  /** An opaque file's blob ref. */
  ref?: string;
  /** Known by its ref but not on disk yet: its bytes are being fetched, and its absence is no removal. */
  pending?: true;
}

/** A file whose text the ledger keeps, to diff its next change into path ops: a k7x document. */
export const keepsText = (rel: string): boolean => isDocFile(rel);

/** A text file past this travels as an opaque file, like audio: a k7x one past 5 MB, any other past 128 KiB (amp models). */
export const textCeiling = (rel: string): number =>
  keepsText(rel) ? 5 * 1024 * 1024 : 128 * 1024;

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

interface IndexedText {
  stamp: string;
  hash: string;
}

/** The binaries' and the text files' hashes by path and stamp, kept across restarts in one JSON file written atomically. */
export class BlobIndex {
  private entries: Record<string, Indexed> = {};
  // Under their own key: a version that reads only `files` must never take a text's hash for a blob.
  private texts: Record<string, IndexedText> = {};
  private written = "";

  constructor(private readonly file: string) {
    try {
      this.written = readFileSync(file, "utf8");
      const saved = JSON.parse(this.written);
      this.entries = saved.files ?? {};
      this.texts = saved.texts ?? {};
    } catch {
      // No index yet, or a torn one: every binary is hashed once more.
    }
  }

  /** The blob `rel` held when it last had this stamp, or null. */
  get(rel: string, stamp: string): BlobId | null {
    const e = this.entries[rel];
    return e && e.stamp === stamp ? { hash: e.hash, size: e.size } : null;
  }

  /** The `textHash` of the text `rel` held when it last had this stamp, or null. */
  textHash(rel: string, stamp: string): string | null {
    const e = this.texts[rel];
    return e && e.stamp === stamp ? e.hash : null;
  }

  /** Rewrite the index from the ledger's files whose stamp has settled; nothing is written when nothing moved. */
  save(ledger: Map<string, Known>, now = Date.now()): void {
    const files: Record<string, Indexed> = {};
    const texts: Record<string, IndexedText> = {};
    for (const [rel, k] of ledger) {
      if (k.pending || !k.stamp) continue;
      if (now - Number(k.stamp.split(":")[1]) <= SETTLE_MS) continue;
      const blob = parseBlobRef(k.ref ?? null);
      if (blob) files[rel] = { stamp: k.stamp, ...blob };
      else if (!k.ref) texts[rel] = { stamp: k.stamp, hash: k.hash };
    }
    const text = JSON.stringify({ files, texts });
    if (text === this.written) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, text);
      renameSync(`${this.file}.tmp`, this.file);
      this.written = text;
      this.entries = files;
      this.texts = texts;
    } catch {
      // A state folder that cannot be written costs a re-hash at the next start, nothing more.
    }
  }
}
