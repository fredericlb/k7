// revision.ts — a cheap token per family that CHANGES when that family's files do, so a
// surface polls it instead of the listing. Modelled on file-service's workspace revision()
// — count plus newest mtime, deliberately not a content hash. See docs/index.md.

import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { familyDir, RECORDINGS_DIR, recordingsDir } from "./layout.ts";
import { FAMILIES, type Family } from "./types.ts";

/** What can carry a token: the families, plus the raw capture zone — see docs/recordings.md. */
export type RevisionKey = Family | typeof RECORDINGS_DIR;

/** Derived, hidden or per-machine junk: none of it is the library's content. */
function skip(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
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
    for (const e of entries) {
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

/** One family's change token, PER FAMILY and not one for the whole library — see docs/index.md. */
export function familyRevision(family: Family): string {
  const { count, newest } = walk(familyDir(family));
  return `${mutations[family] ?? 0}:${count}:${newest}`;
}

/** The capture zone's own token — it used to ride on the songs family and refetch it per capture. */
export function recordingsRevision(): string {
  const { count, newest } = walk(recordingsDir());
  return `${mutations[RECORDINGS_DIR] ?? 0}:${count}:${newest}`;
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
