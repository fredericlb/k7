// parseStore.ts — yamlCache's parses kept ON DISK and keyed by CONTENT, so a file service that starts again
// does not re-parse the module vocabulary, and a first launch finds the bundled library already parsed
// (`parse-cache.json` beside the bundle, made by scripts/parseCacheSeed.ts). Two layers: the account's,
// written, and the bundle's, read-only. Off outside a bundle: a parse is only as good as its parser.
// See docs/moduleCache.md.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { sugarKind } from "@studio/song-schema/yaml/sugar";
import { studioHome } from "../studioHome";

interface StoreFile {
  /** The code that parsed: a parse from another build is a guess, so the account's store is dropped whole. */
  code: string;
  entries: Record<string, unknown>;
}

/** How many entries the account's store keeps. */
const MAX_ENTRIES = 6000;
/** How long the store must stay quiet before it is written, so a compile's hundreds are ONE write. */
const FLUSH_MS = 2000;
/** …and the longest a new parse waits all the same, while parses keep coming. */
const MAX_WAIT_MS = 30_000;
/** The bundle's own store, beside `bin/`. */
export const SEED_FILE = "parse-cache.json";

let file: string | null | undefined;
let code = "";
let entries: Record<string, unknown> | null = null;
let seed: Record<string, unknown> | null | undefined;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** When the oldest unwritten parse came, or 0 when everything is written. */
let dirtySince = 0;
let exitHooked = false;

/** The running bundle file, or null for a source run under a loader, or a test. */
function bundleFile(): string | null {
  const entry = process.argv[1] ?? "";
  return entry.endsWith(".mjs") && existsSync(entry) ? entry : null;
}

/** What a parse of `raw` read at `path` depends on: the parser, the file's short form, its bytes. */
export function parseKey(kind: string, path: string, raw: string): string {
  return createHash("sha1")
    .update(`${kind}\0${sugarKind(path) ?? ""}\0`)
    .update(raw)
    .digest("base64");
}

/** The account's store, read once; null when it is off. */
function own(): Record<string, unknown> | null {
  if (file === undefined) {
    const bundle = process.env.STUDIO_PARSE_CACHE === "1" ? bundleFile() : null;
    let stamp = "";
    if (bundle) {
      const st = statSync(bundle);
      stamp = `${st.size}:${st.mtimeMs}`;
    }
    // Beside the account's workspace, never in it: it is this machine's, and must not sync.
    file = bundle ? join(studioHome(), ".parse-cache.json") : null;
    code = stamp;
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

/** The bundle's store, read on the first miss of the account's; null when this is no bundle or it has none. */
function bundled(): Record<string, unknown> | null {
  if (seed !== undefined) return seed;
  seed = null;
  const bundle = bundleFile();
  if (!bundle || process.env.STUDIO_PARSE_CACHE !== "1") return seed;
  try {
    const at = join(dirname(dirname(bundle)), SEED_FILE);
    seed = (JSON.parse(readFileSync(at, "utf8")) as StoreFile).entries ?? null;
  } catch {
    seed = null;
  }
  return seed;
}

/** A stored parse under `key`, the account's first, then the bundle's. */
export function storedParse(key: string): { value: unknown } | null {
  const mine = own();
  if (mine && key in mine) return { value: mine[key] };
  const theirs = bundled();
  return theirs && key in theirs ? { value: theirs[key] } : null;
}

/** Remember a parse in the account's store; written a little later, with whatever else came meanwhile. */
export function storeParse(key: string, value: unknown): void {
  const mine = own();
  if (!mine) return;
  delete mine[key]; // re-inserted at the young end: insertion order is the eviction order
  mine[key] = value;
  dirty = true;
  const now = Date.now();
  if (!dirtySince) dirtySince = now;
  // Whatever is unwritten when the process ends cleanly is written then.
  if (!exitHooked) {
    exitHooked = true;
    process.once("exit", flush);
  }
  // Rearmed on every parse, so the whole serialization runs once things go quiet — docs/moduleCache.md.
  if (timer) clearTimeout(timer);
  const wait = Math.min(FLUSH_MS, dirtySince + MAX_WAIT_MS - now);
  timer = setTimeout(flush, Math.max(0, wait));
  timer.unref?.();
}

/** Write the account's store, the oldest entries past the bound dropped; atomic, so a crash leaves the old one. */
export function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirtySince = 0;
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

/** Forget the stores' state — for a test, which also sets `$STUDIO_PARSE_CACHE` and `process.argv[1]`. */
export function resetParseStore(): void {
  file = undefined;
  entries = null;
  seed = undefined;
  dirty = false;
  dirtySince = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}
