// yamlCache.ts — one file read and parsed, kept against its mtime and size, and only once that
// mtime is old enough that no later write could reproduce it. A compile then re-reads the file it
// just edited and nothing else. What a parser returns is SHARED between callers: hand it out only
// where something rebuilds or clones it — see docs/moduleCache.md.

import { statSync } from "node:fs";
import { YAML_READ } from "@studio/song-schema/yaml/yamlText";
import { parse as parseYaml } from "yaml";
// How old an mtime must be to be trusted as a key — this cache's whole correctness, and not only
// this one's, which is why the window has one spelling. See docs/moduleCache.md.
import { SETTLE_MS } from "../moduleCache";
import { realPath, wsRead } from "./workspaceFile";

/** How many parsed files to hold. A song is ~200 of them, its module libraries ~800 more. */
const MAX_FILES = 4000;

interface Entry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

/** Keyed by parser then path, so one file read two ways keeps both. */
const memo = new Map<string, Entry>();

/** `parse` of `path`'s text, from the cache when the file has SETTLED — `kind` names the parser. */
export function settledParse<T>(
  path: string,
  kind: string,
  parse: (text: string) => T,
): T {
  let st: { mtimeMs: number; size: number };
  try {
    st = statSync(realPath(path));
  } catch {
    // Vanished since the readdir: read anyway, and never cache what we could not stat.
    return parse(wsRead(path));
  }
  const key = `${kind}\0${realPath(path)}`;
  // A future mtime — a skewed clock on a network mount — is never settled, so never cached.
  const settled = Date.now() - st.mtimeMs > SETTLE_MS;
  const hit = memo.get(key);
  if (settled && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    memo.delete(key); // insertion order is the LRU: a hit goes back to the young end
    memo.set(key, hit);
    return hit.value as T;
  }
  const value = parse(wsRead(path));
  if (!settled) {
    // Still inside the window where the next write could reuse this stamp — storing it would hit later.
    memo.delete(key);
    return value;
  }
  memo.delete(key);
  memo.set(key, { mtimeMs: st.mtimeMs, size: st.size, value });
  for (const oldest of memo.keys()) {
    if (memo.size <= MAX_FILES) break;
    memo.delete(oldest);
  }
  return value;
}

/** `path` parsed as YAML 1.2, from the cache when it has SETTLED — see docs/moduleCache.md. */
export function parsedYaml(path: string): unknown {
  return settledParse(path, "yaml", (t) => parseYaml(t, YAML_READ));
}

/** `path`'s text, from the cache when it has SETTLED — a string, so sharing it is safe. */
export function settledText(path: string): string {
  return settledParse(path, "text", (t) => t);
}

/** Forget everything — for a test that wants a cold read of a file it has already loaded. */
export function clearYamlCache(): void {
  memo.clear();
}
