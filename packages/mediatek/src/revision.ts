// revision.ts — a cheap token per family that CHANGES when that family's files do, so a
// surface polls it instead of the listing. Count plus newest mtime, deliberately not a content
// hash. Cheap is RELATIVE: the walk is the library's size, so a service starts the refresher
// below and every reader then answers from the last one. See docs/index.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
// What a derived sidecar is CALLED, from the package that writes one — two spellings would
// make the sweep that fills them invalidate the listing it walks (docs/index.md).
import { CACHE_EXT } from "@studio/audio-analysis/sidecar";
import { familyDir, RECORDINGS_DIR, recordingsDir } from "./layout.ts";
import { withoutDerived } from "./media.ts";
import { FAMILIES, type Family } from "./types.ts";

/** What can carry a token: the families, plus the raw capture zone — see docs/recordings.md. */
export type RevisionKey = Family | typeof RECORDINGS_DIR;

/** Derived, hidden or per-machine junk: none of it is the library's content. */
function skip(name: string): boolean {
  return (
    name.startsWith(".") ||
    name === "node_modules" ||
    // A `{file}.cache` is MEASURED from a file this walk already counts (docs/index.md).
    name.endsWith(CACHE_EXT)
  );
}

/** How many directories are read, and how many files stat'd, at once — a walk is latency, not CPU. */
const FANOUT = 32;

/** The same count as `walk`, off the event loop: what the refresher runs so nothing waits on a walk. */
async function walkAsync(
  dir: string,
): Promise<{ count: number; newest: number }> {
  const dirs = [dir];
  const files: string[] = [];
  while (dirs.length) {
    const batch = dirs.splice(0, FANOUT);
    const listings = await Promise.all(
      batch.map((d) =>
        readdir(d, { withFileTypes: true }).catch((): Dirent[] => []),
      ),
    );
    // A FLAC's derived MP3 is skipped like a `.cache`: writing one must not move the token.
    for (const entries of listings)
      for (const e of withoutDerived(entries)) {
        if (skip(e.name)) continue;
        const p = join(e.parentPath, e.name);
        if (e.isDirectory()) dirs.push(p);
        else files.push(p);
      }
  }
  let newest = 0;
  for (let i = 0; i < files.length; i += FANOUT) {
    const times = await Promise.all(
      files
        .slice(i, i + FANOUT)
        // Raced away between readdir and stat: the next pass sees it.
        .map((f) =>
          stat(f)
            .then((st) => st.mtimeMs)
            .catch(() => 0),
        ),
    );
    for (const m of times) if (m > newest) newest = m;
  }
  return { count: files.length, newest };
}

/** Count + newest mtime under a directory, an unreadable one counting as empty rather than failing. */
function walk(dir: string): { count: number; newest: number } {
  let count = 0;
  let newest = 0;
  const rec = (abs: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of withoutDerived(entries)) {
      if (skip(e.name)) continue;
      const p = join(abs, e.name);
      if (e.isDirectory()) {
        rec(p);
        continue;
      }
      count++;
      try {
        const m = statSync(p).mtimeMs;
        if (m > newest) newest = m;
      } catch {
        /* raced away between readdir and stat — the next poll sees it */
      }
    }
  };
  rec(dir);
  return { count, newest };
}

/** Our OWN writes, per family — the walk alone cannot see an in-place replacement; docs/index.md. */
const mutations: Partial<Record<RevisionKey, number>> = {};

/** Record that this family or zone was written to. Called by whatever did the writing. */
export function bumped(key: RevisionKey): void {
  mutations[key] = (mutations[key] ?? 0) + 1;
}

/** Where each key's directory is — one map, so the refresher walks exactly what the readers ask for. */
const dirOf = (key: RevisionKey): string =>
  key === RECORDINGS_DIR ? recordingsDir() : familyDir(key);

/** The last walk per key. EMPTY until a service starts the refresher, and then the only walk anyone waits for. */
const walked = new Map<RevisionKey, { count: number; newest: number }>();
let refresher: ReturnType<typeof setTimeout> | null = null;
// Which start the running cycle belongs to: a walk finishing after a stop never re-arms the timer.
let cycleId = 0;
let refreshing = false;

/** The mutation counter is read HERE, not stored: our own write must move the token before any walk confirms it. */
const token = (
  key: RevisionKey,
  w: { count: number; newest: number },
): string => `${mutations[key] ?? 0}:${w.count}:${w.newest}`;

/** One key's token: the refresher's last walk when there is one, else a walk right now. */
function revisionOf(key: RevisionKey): string {
  const held = walked.get(key);
  return token(key, held ?? walk(dirOf(key)));
}

/** One family's change token, PER FAMILY and not one for the whole library — see docs/index.md. */
export function familyRevision(family: Family): string {
  return revisionOf(family);
}

/** The capture zone's own token — riding on the songs family would refetch it per capture. */
export function recordingsRevision(): string {
  return revisionOf(RECORDINGS_DIR);
}

/** Walk every key once, off the event loop — exported for a service that wants the first pass awaited. */
export async function refreshRevisions(): Promise<void> {
  for (const key of [...FAMILIES, RECORDINGS_DIR] as RevisionKey[])
    walked.set(key, await walkAsync(dirOf(key)));
}

/**
 * Start answering every token from a background walk instead of walking per request. Idempotent,
 * and `unref`ed so it never holds a process open. What it costs in freshness: docs/index.md.
 */
export function startRevisionRefresh(everyMs = 10_000): void {
  if (refreshing) return;
  refreshing = true;
  const id = ++cycleId;
  // Re-armed only once a walk has FINISHED: on a slow volume, walks never stack up behind each other.
  const cycle = (): void => {
    void refreshRevisions()
      .catch(() => {})
      .finally(() => {
        if (!refreshing || id !== cycleId) return;
        refresher = setTimeout(cycle, everyMs);
        refresher.unref?.();
      });
  };
  cycle();
}

/** Stop it, and go back to walking per request — for a test, and for a root that changed under us. */
export function stopRevisionRefresh(): void {
  refreshing = false;
  cycleId++;
  if (refresher) clearTimeout(refresher);
  refresher = null;
  walked.clear();
}

/** Every token at once, zone included, because one poll drives the whole screen and its tabs. */
export function revisions(): Record<RevisionKey, string> {
  return {
    ...(Object.fromEntries(
      FAMILIES.map((f) => [f, familyRevision(f)]),
    ) as Record<Family, string>),
    [RECORDINGS_DIR]: recordingsRevision(),
  };
}
