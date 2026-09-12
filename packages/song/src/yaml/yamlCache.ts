// yamlCache.ts — the parsed YAML of one file, kept against its mtime and size, and only once
// that mtime is old enough that no later write could reproduce it. A compile then re-reads the
// file it just edited and nothing else. The raw parse never leaves this module — see
// docs/moduleCache.md for why that is what makes handing the result out safe.

import { readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";
// How old an mtime must be to be trusted as a key — this cache's whole correctness, and not only
// this one's, which is why the window has one spelling. See docs/moduleCache.md.
import { SETTLE_MS } from "../moduleCache";

/** How many parsed files to hold. A song is ~200 of them, and one service drives a handful. */
const MAX_FILES = 4000;

interface Entry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

const memo = new Map<string, Entry>();

/** `path` parsed as YAML 1.2, from the cache when it has SETTLED — see docs/moduleCache.md. */
export function parsedYaml(path: string): unknown {
  let st: { mtimeMs: number; size: number };
  try {
    st = statSync(path);
  } catch {
    // Vanished since the readdir: read anyway, and never cache what we could not stat.
    return parseYaml(readFileSync(path, "utf8"), { version: "1.2" });
  }
  // A future mtime — a skewed clock on a network mount — is never settled, so never cached.
  const settled = Date.now() - st.mtimeMs > SETTLE_MS;
  const hit = memo.get(path);
  if (settled && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    memo.delete(path); // insertion order is the LRU: a hit goes back to the young end
    memo.set(path, hit);
    return hit.value;
  }
  const value = parseYaml(readFileSync(path, "utf8"), { version: "1.2" });
  if (!settled) {
    // Still inside the window where the next write could reuse this stamp — storing it would hit later.
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
