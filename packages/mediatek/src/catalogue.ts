// catalogue.ts — the queryable view over the library: listings held in memory, rebuilt
// per family when that family's revision moves, warm-started from .cache/index.json so a
// restart doesn't re-walk the disk. No database anywhere. See docs/index.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
let warmed = false;

/** The shape of a persisted listing — **bump it whenever what the scan PRODUCES changes**, see docs/index.md. */
const INDEX_VERSION = 4;

/** Pull whatever the last process left behind; any problem at all just means a cold start. */
function warm(): void {
  if (warmed) return;
  warmed = true;
  try {
    const raw = JSON.parse(readFileSync(indexPath(), "utf8")) as {
      version?: number;
      families?: Record<string, FamilyListing>;
    };
    if (raw.version !== INDEX_VERSION) return; // written by another build — walk instead
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
}

/** Best-effort persist — a library on a full or read-only disk still works, it just walks again. */
function persist(): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const families = Object.fromEntries(
      [...memory.entries()].map(([f, l]) => [f, l]),
    );
    writeFileSync(
      indexPath(),
      JSON.stringify({ version: INDEX_VERSION, families }),
      "utf8",
    );
  } catch {
    /* cache is an optimisation, never a requirement */
  }
}

/** One family's listing, rescanned only when its revision moved — the walk is what the token avoids. */
export function listFamily(family: Family): FamilyListing {
  warm();
  const rev = familyRevision(family);
  const cached = memory.get(family);
  if (cached && cached.rev === rev) return cached;
  const entries = scanFamily(family);
  const listing: FamilyListing = {
    family,
    rev,
    entries,
    unlisted: scanUnlisted(family, entries),
  };
  memory.set(family, listing);
  persist();
  return listing;
}

/** Every family at once — what the catalogue screen opens with. */
export function listAll(): FamilyListing[] {
  return FAMILIES.map(listFamily);
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
export function search(query: Query = {}): MediatekEntry[] {
  const families = query.family ? [query.family] : FAMILIES;
  const needle = query.q?.trim().toLowerCase();
  const out: MediatekEntry[] = [];
  for (const f of families)
    for (const e of listFamily(f).entries) {
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
export function summary(): {
  present: boolean;
  counts: Record<string, number>;
} {
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
    FAMILIES.map((f) => [f, listFamily(f).entries.length]),
  ) as Record<string, number>;
  return {
    present: true,
    counts: {
      ...counts,
      [RECORDINGS_DIR]: countRecordings(),
      [PLAYLISTS_DIR]: listPlaylists().length,
    },
  };
}

/** Drop the in-memory index. For tests, and for a root that changed under us. */
export function reset(): void {
  memory.clear();
  warmed = false;
}
