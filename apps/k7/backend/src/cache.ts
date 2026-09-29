// cache.ts — k7's caches kept bounded: first hits on the same work share one promise, the row caches are
// swept of what expired, and the disk cache is trimmed oldest-first past a size (docs/audit.md).
// The one thing a reader would get wrong: the disk cache holds COPIES only — every reader refills a miss.

import fs from "node:fs";
import path from "node:path";

/** `fn` once per key while it runs: concurrent callers — a public page's first visitors — share its promise. */
export function once<T>(
  inflight: Map<string, Promise<T>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// A row cache past this many entries drops its oldest: ids probed and never seen again must not pile up.
const MAX_ROWS = 5_000;

/** Drop the expired rows of each map, and its oldest past MAX_ROWS — a Map iterates in insertion order. */
export function sweepRowCaches(maps: Map<string, { exp: number }>[]): void {
  const now = Date.now();
  for (const m of maps) {
    for (const [k, v] of m) if (v.exp <= now) m.delete(k);
    for (const k of m.keys()) {
      if (m.size <= MAX_ROWS) break;
      m.delete(k);
    }
  }
}

/** Whether a cached file is there — and if so, marked as used just now, so the trim takes the least recently used. */
export function cachedFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const now = new Date();
  fs.utimes(file, now, now, () => {});
  return true;
}

// A file younger than this may be being written or about to be served: the trim leaves it alone.
const MIN_AGE_MS = 10 * 60_000;

/** Delete the oldest files past `maxBytes`, never a temporary one or one younger than MIN_AGE_MS. */
export function trimDiskCache(dir: string, maxBytes: number): number {
  let entries: { file: string; size: number; mtime: number }[];
  try {
    entries = fs.readdirSync(dir).flatMap((name) => {
      if (name.startsWith("tmp-") || name.endsWith(".part")) return [];
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        return st.isFile() ? [{ file, size: st.size, mtime: st.mtimeMs }] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return 0;
  }
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  const cutoff = Date.now() - MIN_AGE_MS;
  let removed = 0;
  for (const e of entries.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxBytes) break;
    if (e.mtime > cutoff) continue;
    try {
      fs.unlinkSync(e.file);
      total -= e.size;
      removed++;
    } catch {
      // Gone already, or held: the next trim tries again.
    }
  }
  return removed;
}
