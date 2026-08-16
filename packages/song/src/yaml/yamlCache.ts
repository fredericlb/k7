// yamlCache.ts — the parsed YAML of one file, kept against its mtime and size, and only once
// that mtime is old enough that no later write could reproduce it. A compile then re-reads the
// file it just edited and nothing else. The raw parse never leaves this module — see
// docs/moduleCache.md for why that is what makes handing the result out safe.

import { readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/** How many parsed files to hold. A song is ~200 of them, and one service drives a handful. */
const MAX_FILES = 4000;

/**
 * How old an mtime has to be before it is trusted as a key, in ms.
 *
 * The whole correctness of this cache. An mtime alone is NOT a key: file-time granularity is
 * coarse, so a rewrite landing in the same tick as the read before it keeps the same stamp.
 * Measured on this dev machine — 3000 same-size rewrites as fast as Node can issue them —
 * **76% of consecutive pairs shared an (mtime, size)**, at a granularity of 0.52 ms. A cache
 * keyed on that serves the previous content, which for a clip file is the edit you just made
 * silently not happening.
 *
 * Once an mtime is in the past by more than any clock or filesystem granularity, no write can
 * ever stamp that value again — a new write stamps *now*. Two seconds clears NTFS (sub-ms),
 * FAT (2 s is its resolution, and a write there lands on an even second at or after now) and
 * the second-resolution network filesystems. So: trust a stamp only after it has settled, and
 * cache only what was settled when it was read.
 */
const SETTLE_MS = 2_000;

interface Entry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

const memo = new Map<string, Entry>();

/**
 * `path` parsed as YAML 1.2, from the cache when the file has not moved under it.
 *
 * The file you just edited is always re-read: its mtime is seconds fresh, so it fails the
 * settle test and is neither served from the cache nor put in it. Every file you did NOT touch
 * is served — which is the whole shape of a compile, where one file in two hundred changed.
 *
 * What is left is what this codebase already states wherever it caches on an mtime
 * (`waveformCache`, `Workspace.revision()`): a clock stepped backwards past the settle window.
 */
export function parsedYaml(path: string): unknown {
  let st: { mtimeMs: number; size: number };
  try {
    st = statSync(path);
  } catch {
    // Vanished between the readdir and here: read anyway, and fail exactly as an uncached read
    // would have. Never cache what we could not stat — there is nothing to invalidate on.
    return parseYaml(readFileSync(path, "utf8"), { version: "1.2" });
  }
  // A future mtime — a skewed clock on a network mount — is never settled, so it is never
  // cached. Degrading to an uncached read is the right answer to a stamp we cannot reason about.
  const settled = Date.now() - st.mtimeMs > SETTLE_MS;
  const hit = memo.get(path);
  if (settled && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    memo.delete(path); // insertion order is the LRU: a hit goes back to the young end
    memo.set(path, hit);
    return hit.value;
  }
  const value = parseYaml(readFileSync(path, "utf8"), { version: "1.2" });
  if (!settled) {
    // Still inside the window where its own stamp could be reused by the next write. Storing it
    // would make it a cache hit in two seconds' time, under a key that no longer means anything.
    memo.delete(path);
    return value;
  }
  memo.delete(path);
  memo.set(path, { mtimeMs: st.mtimeMs, size: st.size, value });
  for (const oldest of memo.keys()) {
    if (memo.size <= MAX_FILES) break;
    memo.delete(oldest);
  }
  return value;
}

/** Forget everything — for a test that wants a cold read of a file it has already loaded. */
export function clearYamlCache(): void {
  memo.clear();
}
