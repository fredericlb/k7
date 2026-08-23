// evict.ts — keeping the cache under a size budget. The counterpart of cache.ts: that one
// decides what the cache SHOULD hold, this one decides what it can AFFORD to. Deliberately
// not automatic, and deliberately not applied to modules. See docs/eviction.md.

import { rmSync, statSync } from "node:fs";
import { heldManifest, rememberManifest } from "./cache.ts";
import { safePath } from "./layout.ts";
import type { Manifest } from "./manifest.ts";
import { bumped } from "./revision.ts";
import type { Family } from "./types.ts";

/** What each family may occupy, in bytes; a family absent from this map is **never evicted** — docs/eviction.md. */
export type EvictionPolicy = Partial<Record<Family, number>>;

export interface EvictionReport {
  family: Family;
  /** Paths deleted, newest-kept-first order reversed: what went, in the order it went. */
  evicted: string[];
  bytesFreed: number;
  /** Bytes before and after; `after` may still exceed the budget when everything left is undeletable. */
  before: number;
  after: number;
  failed: { path: string; error: string }[];
}

/** When the cache fetched a file — its local mtime, since nothing rewrites the bytes in place. */
function fetchedAt(path: string): number {
  try {
    return statSync(safePath(path)).mtimeMs;
  } catch {
    return 0; // gone already, or unreadable — evict it first, it costs nothing
  }
}

/** Bring one family under budget, least-recently-FETCHED first, rewriting the manifest — docs/eviction.md. */
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
    // A file that alone exceeds the budget is still dropped: the budget is the promise.
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
      // Undeletable means still present, so it stays in the manifest rather than being forgotten.
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

/** What a family occupies, per the remembered manifest — the number a settings screen shows. */
export function familyBytes(family: Family): number {
  return heldManifest(family).reduce((n, e) => n + e.bytes, 0);
}
