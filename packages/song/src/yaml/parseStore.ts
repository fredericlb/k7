// parseStore.ts — yamlCache's parses kept ON DISK, so a file service that starts again (every app launch
// on a phone, every idle stop) does not re-parse the whole module vocabulary: ~1.5 s on a PC, ten on a phone.
// The one thing a reader would get wrong: it is OFF unless `$STUDIO_PARSE_CACHE` is 1, and even then only in a
// BUNDLE — a parse is only as good as the parser that made it, and the bundle is what is stamped.
// See docs/moduleCache.md.

import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { studioHome } from "../studioHome";

interface Stored {
  mtimeMs: number;
  size: number;
  value: unknown;
}

interface StoreFile {
  /** The code that parsed: a parse from another build is a guess, so the whole file is dropped. */
  code: string;
  entries: Record<string, Stored>;
}

/** How many entries to keep, as yamlCache's own bound. */
const MAX_ENTRIES = 4000;
/** How long new parses wait to be written, so a compile's hundreds are ONE write. */
const FLUSH_MS = 2000;

let file: string | null | undefined;
let code = "";
let entries: Record<string, Stored> | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The running bundle's stamp, or null when this is not a bundle — source run under a loader, a test. */
function bundleStamp(): string | null {
  const entry = process.argv[1] ?? "";
  if (!entry.endsWith(".mjs")) return null;
  try {
    const st = statSync(entry);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

/** The store's file, read once; null when the store is off. */
function open(): Record<string, Stored> | null {
  if (file === undefined) {
    // Beside the account's workspace, never in it: it is this machine's, and must not sync.
    const stamp = process.env.STUDIO_PARSE_CACHE === "1" ? bundleStamp() : null;
    file = stamp ? join(studioHome(), ".parse-cache.json") : null;
    code = stamp ?? "";
  }
  if (!file) return null;
  if (entries) return entries;
  try {
    const read = JSON.parse(readFileSync(file, "utf8")) as StoreFile;
    entries = read.code === code && read.entries ? read.entries : {};
  } catch {
    entries = {}; // none yet, or unreadable: it is only a cache
  }
  return entries;
}

/** A stored parse of `key` when the file still has this mtime and size. */
export function storedParse(
  key: string,
  st: { mtimeMs: number; size: number },
): { value: unknown } | null {
  const hit = open()?.[key];
  return hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size
    ? { value: hit.value }
    : null;
}

/** Remember a parse of a SETTLED file — yamlCache decides that, by the same window. */
export function storeParse(
  key: string,
  st: { mtimeMs: number; size: number },
  value: unknown,
): void {
  const all = open();
  if (!all) return;
  delete all[key]; // re-inserted at the young end: insertion order is the eviction order
  all[key] = { mtimeMs: st.mtimeMs, size: st.size, value };
  dirty = true;
  if (!timer) {
    timer = setTimeout(flush, FLUSH_MS);
    timer.unref?.();
  }
}

/** Write the store, the oldest entries past the bound dropped; atomic, so a crash leaves the old one. */
export function flush(): void {
  timer = null;
  if (!dirty || !file || !entries) return;
  dirty = false;
  const keys = Object.keys(entries);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)))
    delete entries[k];
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ code, entries } satisfies StoreFile));
    renameSync(tmp, file);
  } catch {
    /* unwritable: the next start parses, as before */
  }
}

/** Forget the store's state — for a test, which also sets `$STUDIO_PARSE_CACHE` and `process.argv[1]`. */
export function resetParseStore(): void {
  file = undefined;
  entries = null;
  dirty = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
