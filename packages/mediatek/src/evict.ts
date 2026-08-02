// evict.ts — keeping the cache under a size budget. The counterpart of cache.ts: that one
// decides what the cache SHOULD hold, this one decides what it can AFFORD to. Deliberately
// not automatic, and deliberately not applied to modules. See docs/eviction.md.

import { rmSync, statSync } from "node:fs";
import { heldManifest, rememberManifest } from "./cache.ts";
import { safePath } from "./layout.ts";
import type { Manifest } from "./manifest.ts";
import { bumped } from "./revision.ts";
import type { Family } from "./types.ts";

/**
 * What each family may occupy, in bytes. A family absent from this map is **never
 * evicted**, which is the default and the right one for `modules`.
 *
 * There is no repo-wide default policy on purpose: a budget is a property of the machine —
 * a laptop on tour and a studio desktop want different numbers — and picking one here
 * would be picking it for a disk this code has never seen.
 */
export type EvictionPolicy = Partial<Record<Family, number>>;

export interface EvictionReport {
  family: Family;
  /** Paths deleted, newest-kept-first order reversed: what went, in the order it went. */
  evicted: string[];
  bytesFreed: number;
  /** Bytes the family occupied before and after. `after` can still exceed the budget when
   *  everything left is unreadable — reported rather than looped over. */
  before: number;
  after: number;
  failed: { path: string; error: string }[];
}

/** When the cache fetched a file, which for a downloaded file is its local mtime: the
 *  bytes were written fresh, and nothing rewrites them in place afterwards. */
function fetchedAt(path: string): number {
  try {
    return statSync(safePath(path)).mtimeMs;
  } catch {
    return 0; // gone already, or unreadable — evict it first, it costs nothing
  }
}

/**
 * Bring one family under its budget by dropping least-recently-FETCHED files first.
 *
 * Two things about this are worth stating plainly rather than discovering later.
 *
 * **It is least-recently-fetched, not least-recently-used.** Nothing in the repo records
 * that a file was played: the moteur opens paths and tells no one, and access times are
 * unreliable (Windows disables them by default, Linux mounts `relatime`). So a file
 * downloaded once and played daily looks exactly like one downloaded once and never
 * touched. Fixing that needs an access ping from whoever opens a file — a real change, and
 * a bigger one than this — so the weakness is named here instead of hidden behind the word
 * "LRU".
 *
 * **It rewrites the remembered manifest.** That is not bookkeeping, it is the correctness
 * of the whole thing: `diff()` compares the owner's description against what the cache
 * REMEMBERS it has, so a file deleted without being forgotten is a file the cache believes
 * it still holds — for ever. It would never be re-fetched, and the moteur would find a
 * missing path with the catalogue insisting all is well.
 */
export function evictFamily(
  family: Family,
  budgetBytes: number,
): EvictionReport {
  const held = heldManifest(family);
  const before = held.reduce((n, e) => n + e.bytes, 0);
  const report: EvictionReport = {
    family,
    evicted: [],
    bytesFreed: 0,
    before,
    after: before,
    failed: [],
  };
  if (before <= budgetBytes) return report;

  // Newest first, so the tail of the list is what goes.
  const byAge = held
    .map((e) => ({ entry: e, at: fetchedAt(e.path) }))
    .sort((a, b) => b.at - a.at || a.entry.path.localeCompare(b.entry.path));

  const keep: Manifest = [];
  let running = 0;
  const doomed: typeof byAge = [];
  for (const item of byAge) {
    // A file that alone exceeds the budget is still dropped rather than kept: the budget
    // is the promise, and one 8 GB video must not be able to void it.
    if (running + item.entry.bytes <= budgetBytes) {
      running += item.entry.bytes;
      keep.push(item.entry);
    } else {
      doomed.push(item);
    }
  }

  for (const item of doomed) {
    try {
      rmSync(safePath(item.entry.path), { force: true });
      report.evicted.push(item.entry.path);
      report.bytesFreed += item.entry.bytes;
    } catch (e) {
      // Undeletable means still present, so it stays in the manifest — the cache must not
      // claim to have forgotten a file it is still carrying.
      keep.push(item.entry);
      report.failed.push({
        path: item.entry.path,
        error: (e as Error).message,
      });
    }
  }

  rememberManifest(
    family,
    keep.sort((a, b) => a.path.localeCompare(b.path)),
  );
  report.after = keep.reduce((n, e) => n + e.bytes, 0);
  if (report.evicted.length) bumped(family);
  return report;
}

/** Apply a whole policy. Families it does not name are left alone — see EvictionPolicy. */
export function evict(policy: EvictionPolicy): EvictionReport[] {
  return Object.entries(policy)
    .filter(([, budget]) => typeof budget === "number")
    .map(([family, budget]) => evictFamily(family as Family, budget as number));
}

/** What a family currently occupies, per the manifest the cache remembers. The number a
 *  settings screen shows beside a budget, and the one `evictFamily` compares against. */
export function familyBytes(family: Family): number {
  return heldManifest(family).reduce((n, e) => n + e.bytes, 0);
}
