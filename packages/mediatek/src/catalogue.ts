// catalogue.ts — the queryable view over the library: listings held in memory, rebuilt
// per family when that family's revision moves, warm-started from .cache/index.json so a
// restart doesn't re-walk the disk. No database anywhere. See docs/index.md.
// A moved family is rescanned in the background, one rescan at a time, and a reader waits for
// it only FRESH_WAIT_MS before taking the previous listing — stamped with its own, older rev.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  cacheDir,
  exists,
  indexPath,
  PLAYLISTS_DIR,
  RECORDINGS_DIR,
} from "./layout.ts";
import { listPlaylists } from "./playlists.ts";
import { countRecordings } from "./recordings.ts";
import { familyRevision } from "./revision.ts";
import { scanFamily, scanUnlisted } from "./scan.ts";
import {
  asFamily,
  FAMILIES,
  type Family,
  type FamilyListing,
  type MediatekEntry,
} from "./types.ts";

const memory = new Map<Family, FamilyListing>();
const rescans = new Map<Family, Promise<FamilyListing>>();
let warming: Promise<void> | null = null;
// Bumped by reset(), so a rescan that outlives it cannot write into the next root's memory.
let generation = 0;

/** The shape of a persisted listing — **bump it whenever what the scan PRODUCES changes**, see docs/index.md. */
const INDEX_VERSION = 5;

/** How long a reader waits on a rescan before it is handed the previous listing instead. */
export const FRESH_WAIT_MS = 250;

/** Pull whatever the last process left behind; any problem at all just means a cold start. */
function warm(): Promise<void> {
  warming ??= (async () => {
    const gen = generation;
    try {
      const raw = JSON.parse(await readFile(indexPath(), "utf8")) as {
        version?: number;
        families?: Record<string, FamilyListing>;
      };
      if (raw.version !== INDEX_VERSION || gen !== generation) return; // written by another build — walk instead
      for (const f of FAMILIES) {
        const l = raw.families?.[f];
        if (l && typeof l.rev === "string" && Array.isArray(l.entries))
          memory.set(f, {
            family: f,
            rev: l.rev,
            entries: l.entries,
            unlisted: Array.isArray(l.unlisted) ? l.unlisted : [],
          });
      }
    } catch {
      /* cold start */
    }
  })();
  return warming;
}

let persisting: Promise<void> | null = null;
let persistAgain = false;

/** Best-effort persist, one write at a time and the last state winning — the cache is never required. */
function persist(): void {
  if (persisting) {
    persistAgain = true;
    return;
  }
  persisting = (async () => {
    do {
      persistAgain = false;
      try {
        await mkdir(cacheDir(), { recursive: true });
        const families = Object.fromEntries(memory.entries());
        // Beside it then renamed, so a reader never meets half an index.
        const tmp = `${indexPath()}.${process.pid}.tmp`;
        await writeFile(
          tmp,
          JSON.stringify({ version: INDEX_VERSION, families }),
          "utf8",
        );
        await rename(tmp, indexPath());
      } catch {
        /* cache is an optimisation, never a requirement */
      }
    } while (persistAgain);
  })().finally(() => {
    persisting = null;
  });
}

/** Resolves once no rescan is running and the index on disk holds what memory holds — for tests, and a clean shutdown. */
export async function flushIndex(): Promise<void> {
  // A rescan still running persists when it ends, so it is waited on too.
  while (rescans.size > 0 || persisting)
    await Promise.allSettled([...rescans.values(), persisting]);
}

/** One rescan per family in flight; a second reader joins it rather than starting another walk. */
function rescan(family: Family): Promise<FamilyListing> {
  const running = rescans.get(family);
  if (running) return running;
  const gen = generation;
  const p = (async (): Promise<FamilyListing> => {
    // Read BEFORE the walk: a write landing during it moves the token again and earns another rescan.
    const rev = familyRevision(family);
    const entries = await scanFamily(family);
    const listing: FamilyListing = {
      family,
      rev,
      entries,
      unlisted: await scanUnlisted(family, entries),
    };
    if (gen === generation) {
      memory.set(family, listing);
      persist();
    }
    return listing;
  })().finally(() => {
    if (rescans.get(family) === p) rescans.delete(family);
  });
  rescans.set(family, p);
  return p;
}

/** One family's listing, rescanned only when its revision moved — `waitMs` bounds how long a stale one is held back. */
export async function listFamily(
  family: Family,
  waitMs: number = FRESH_WAIT_MS,
): Promise<FamilyListing> {
  await warm();
  const cached = memory.get(family);
  if (cached && cached.rev === familyRevision(family)) return cached;
  const next = rescan(family);
  if (!cached || waitMs === Number.POSITIVE_INFINITY) return next;
  // The rescan goes on whoever stops waiting for it; its failure only means the old listing stays.
  next.catch(() => {});
  if (waitMs <= 0) return cached;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<FamilyListing>((done) => {
    timer = setTimeout(() => done(cached), waitMs);
  });
  try {
    return await Promise.race([next.catch(() => cached), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The listing as of now, however long the rescan takes — for a caller that acts on what is there. */
export function listFamilyFresh(family: Family): Promise<FamilyListing> {
  return listFamily(family, Number.POSITIVE_INFINITY);
}

/** Every family at once — what the catalogue screen opens with. */
export function listAll(): Promise<FamilyListing[]> {
  return Promise.all(FAMILIES.map((f) => listFamily(f)));
}

export interface Query {
  family?: Family;
  /** Case-insensitive substring over the name and the path. Absent == everything. */
  q?: string;
  /** The family's own subdivision, e.g. "recorded" or "instruments". */
  kind?: string;
  limit?: number;
}

/** The ceiling on `limit`, applied where a caller's number arrives and never inside `search`. */
export const SEARCH_LIMIT_MAX = 1000;

/** A `Query` out of untrusted URL parameters, `limit` clamped and anything unusable becoming undefined. */
export function parseQuery(q: Record<string, unknown>): Query {
  const rawLimit = Number(q.limit);
  return {
    family: asFamily(q.family),
    q: typeof q.q === "string" ? q.q : undefined,
    kind: typeof q.kind === "string" ? q.kind : undefined,
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), SEARCH_LIMIT_MAX)
        : undefined,
  };
}

/** Filter in memory — a scan over an array, not an index lookup, because there is no index. */
export async function search(query: Query = {}): Promise<MediatekEntry[]> {
  const families = query.family ? [query.family] : FAMILIES;
  const needle = query.q?.trim().toLowerCase();
  const out: MediatekEntry[] = [];
  const listings = await Promise.all(families.map((f) => listFamily(f)));
  for (const listing of listings)
    for (const e of listing.entries) {
      if (query.kind && e.kind !== query.kind) continue;
      if (
        needle &&
        !e.name.toLowerCase().includes(needle) &&
        !e.path.toLowerCase().includes(needle)
      )
        continue;
      out.push(e);
      if (query.limit && out.length >= query.limit) return out;
    }
  return out;
}

/** How many of each family plus the capture zone, and whether there is a library at all. */
export async function summary(): Promise<{
  present: boolean;
  counts: Record<string, number>;
}> {
  if (!exists())
    return {
      present: false,
      // Derived from FAMILIES, so adding one cannot leave the tab bar a number short.
      counts: {
        ...Object.fromEntries(FAMILIES.map((f) => [f, 0])),
        [RECORDINGS_DIR]: 0,
        [PLAYLISTS_DIR]: 0,
      },
    };
  const counts = Object.fromEntries(
    (await listAll()).map((l) => [l.family, l.entries.length]),
  ) as Record<string, number>;
  return {
    present: true,
    counts: {
      ...counts,
      [RECORDINGS_DIR]: countRecordings(),
      [PLAYLISTS_DIR]: (await listPlaylists()).length,
    },
  };
}

/** Drop the in-memory index. For tests, and for a root that changed under us. */
export function reset(): void {
  memory.clear();
  rescans.clear();
  warming = null;
  generation++;
}
