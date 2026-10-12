// blobSweep.ts — the blob store's collection: a blob that no room of its account names anywhere, and that has
// not been asked for in a week, goes. "Anywhere" is every file a room keeps: its current files, its open
// conflicts, and its whole history, segments and snapshots alike. History keeps every ref forever, so what
// this removes is only an ORPHAN: an upload whose batch was never ordered. See docs/blobs.md.

import type { Dirent } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isBlobHash } from "@studio/live-sync/blob";
import { roomDir } from "./syncRelay.ts";

/** An unnamed blob younger than this may belong to a batch still on its way: it stays. */
export const ORPHAN_AGE_MS = 7 * 24 * 60 * 60_000;

/** A ref as any file of a room spells it, JSON-escaped NUL or not: `st0fs-blob <sha256>`. */
const REF = /st0fs-blob ([0-9a-f]{64})/g;

async function filesBelow(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesBelow(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Every blob hash named by any file the rooms under `accountDir` keep. */
export async function referencedBlobs(
  accountDir: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  // The folder every room of the account lives in, as the relay lays it out.
  for (const file of await filesBelow(dirname(roomDir(accountDir, "_")))) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const m of text.matchAll(REF)) out.add(m[1]);
  }
  return out;
}

/** Remove `file` when it was last written or asked for before `cutoff`; answers whether it went. */
async function dropIfOlder(file: string, cutoff: number): Promise<boolean> {
  try {
    if ((await stat(file)).mtimeMs >= cutoff) return false;
    await rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Sweep the store at `storeDir` against the rooms of `accountDir`; answers the hashes removed. */
export async function sweepBlobs(
  storeDir: string,
  accountDir: string,
  opts: { now?: number; minAgeMs?: number } = {},
): Promise<string[]> {
  const cutoff = (opts.now ?? Date.now()) - (opts.minAgeMs ?? ORPHAN_AGE_MS);
  const named = await referencedBlobs(accountDir);
  const removed: string[] = [];
  let shards: string[];
  try {
    shards = await readdir(storeDir);
  } catch {
    return removed;
  }
  for (const shard of shards) {
    const dir = join(storeDir, shard);
    // Partial uploads and unfinished temporaries are orphans by age alone.
    if (shard === "partial" || shard === "tmp") {
      for (const f of await filesBelow(dir)) await dropIfOlder(f, cutoff);
      continue;
    }
    if (!/^[0-9a-f]{2}$/.test(shard)) continue;
    for (const hash of await readdir(dir).catch(() => [] as string[]))
      if (
        isBlobHash(hash) &&
        !named.has(hash) &&
        (await dropIfOlder(join(dir, hash), cutoff))
      )
        removed.push(hash);
  }
  return removed;
}
