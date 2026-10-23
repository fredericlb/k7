// envelopeMemo.ts — `/envelope`'s answer, serialised once per version of a file and its sidecar.
// A sidecar is ~350 KB of JSON, and parsing it plus fingerprinting the file on every draw of a
// waveform is synchronous work every other request waits behind (../../docs/media/analysis.md).
// The one thing a reader would get wrong: the VERSION is both stats, so a new sidecar is a new answer.

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { cachePath } from "@studio/audio-analysis/sidecar";

/** How many answers are held at once, oldest dropped first — a few hundred KB each. */
const ENVELOPE_MEMO_MAX = 16;

/** Bumped when the answer's SHAPE changes, so a browser's copy from an older build never matches. */
const SHAPE = "e2";

interface Held {
  version: string;
  body: string;
  etag: string;
}

const held = new Map<string, Held>();

/** The file's size and time beside its sidecar's, or the file's alone while it has none. */
export async function envelopeVersion(source: string): Promise<string> {
  const [file, side] = await Promise.all([
    stat(source),
    stat(cachePath(source)).catch(() => null),
  ]);
  const sidecar = side ? `${side.size}-${side.mtimeMs}` : "none";
  return `${file.size}-${file.mtimeMs}/${sidecar}`;
}

/** The validator a version is served under; opaque to the client, and weak like the files'. */
export function envelopeEtag(version: string): string {
  const h = createHash("sha1")
    .update(`${SHAPE}:${version}`)
    .digest("base64url");
  return `W/"${h.slice(0, 22)}"`;
}

/** The held answer when the file and its sidecar have not moved, else `compute`'s, held for next time. */
export async function envelopeOf(
  source: string,
  compute: () => Promise<unknown>,
): Promise<{ body: string; etag: string }> {
  const before = await envelopeVersion(source);
  const have = held.get(source);
  if (have && have.version === before) {
    // Re-inserted, so the Map's order is least recently used first.
    held.delete(source);
    held.set(source, have);
    return have;
  }
  const body = JSON.stringify(await compute());
  // Read again: an analysis that just ran wrote the sidecar this answer was made from.
  const version = await envelopeVersion(source);
  const next = { version, body, etag: envelopeEtag(version) };
  held.delete(source);
  held.set(source, next);
  while (held.size > ENVELOPE_MEMO_MAX)
    held.delete(held.keys().next().value as string);
  return next;
}
