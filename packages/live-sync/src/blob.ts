// blob.ts — a binary file as live sync carries it: a REF in place of its text, naming its bytes by sha256.
// A ref starts with a NUL, which no text file can (capture treats a NUL as binary), so it never collides with one.
// See ../../file-hub/docs/blobs.md.

import type { FileOp } from "./ops.ts";

const PREFIX = "\u0000st0fs-blob ";
const REF_TAIL = /^([0-9a-f]{64}) (\d+)\n$/;

/** A blob's identity: the sha256 of its bytes, as lowercase hex, and their length. */
export interface BlobId {
  hash: string;
  size: number;
}

/** True for a sha256 as a blob store names it: 64 lowercase hex digits. */
export const isBlobHash = (s: string): boolean => /^[0-9a-f]{64}$/.test(s);

/** The text standing for a binary file's bytes. */
export function blobRef(hash: string, size: number): string {
  if (!isBlobHash(hash)) throw new Error(`not a sha256: ${hash}`);
  return `${PREFIX}${hash} ${size}\n`;
}

/** The blob a text names, or null when it is an ordinary text. */
export function parseBlobRef(text: string | null): BlobId | null {
  if (text === null || !text.startsWith(PREFIX)) return null;
  const m = REF_TAIL.exec(text.slice(PREFIX.length));
  return m ? { hash: m[1], size: Number(m[2]) } : null;
}

export const isBlobRef = (text: string | null): boolean =>
  parseBlobRef(text) !== null;

/** Every blob the ops write, each once: what must be on the store before their batch is sent. */
export function blobsOf(ops: FileOp[]): BlobId[] {
  const out = new Map<string, BlobId>();
  for (const op of ops) {
    const id = op.kind === "text" ? parseBlobRef(op.text) : null;
    if (id) out.set(id.hash, id);
  }
  return [...out.values()];
}
