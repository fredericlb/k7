// helpers.ts — what every part of the store shares: the disk cache, the short-lived row caches, the
// row mappers sessions and moments both read, and the small file and tag helpers.

import fs from "node:fs";
import path from "node:path";
import type { Annotation, Marker } from "@studio/rehearsal-shared";
import { sweepRowCaches, trimDiskCache } from "../cache.ts";
import type { Row } from "../db.ts";
import * as db from "../db.ts";
import { env } from "../env.ts";
import * as mediatek from "../mediatek.ts";
import type { Collection, FieldsOf } from "../schema.ts";

// Under K7_DATA_DIR, never inside the sources: a checkout and an image hold it in the same place.
export const CACHE_DIR = path.join(env.dataDir, "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

/** Remove the uploads a request did not keep — the store MOVES the ones it keeps, so what is left is refused or failed. */
export function discardUploads(files: { path?: string }[]): void {
  for (const f of files) if (f.path) safeUnlink(f.path);
}

// One download per file at a time, however many requests ask for it together (../cache.ts).
export const fetching = new Map<string, Promise<unknown>>();

/** How long a cached row answers before the store is read again. */
export const ROW_TTL_MS = 15_000;

interface Cached<T> {
  rec: T;
  exp: number;
}

// Every row cache, registered as it is made, so the sweep reaches them all.
const rowCaches: Map<string, { exp: number }>[] = [];

/** A short-lived cache of rows by uid, swept by `startCacheSweeps`. */
export function rowCache<T>(): Map<string, Cached<T>> {
  const cache = new Map<string, Cached<T>>();
  rowCaches.push(cache);
  return cache;
}

/** Keep the caches bounded while serving: rows swept every minute, the disk trimmed every ten (../../docs/audit.md); returns the stop. */
export function startCacheSweeps(): () => void {
  const rows = setInterval(() => sweepRowCaches(rowCaches), 60_000);
  const disk = setInterval(() => {
    const removed = trimDiskCache(CACHE_DIR, env.cacheMaxBytes);
    if (removed)
      console.log(`[cache] trimmed ${removed} file(s) from ${CACHE_DIR}`);
  }, 10 * 60_000);
  rows.unref();
  disk.unref();
  return () => {
    clearInterval(rows);
    clearInterval(disk);
  };
}

/** A row by its primary key, or null unless each `scope` field matches: the key finds it, the scope guards it — ../../docs/ownership.md. */
export function rowIn<C extends Collection>(
  coll: C,
  id: string,
  scope: Partial<FieldsOf<C>>,
): Row<C> | null {
  const rec = db.getRecord(coll, String(id));
  if (!rec) return null;
  const fields = rec.fields as Record<string, unknown>;
  for (const [k, v] of Object.entries(scope)) if (fields[k] !== v) return null;
  return rec;
}

export function mapMarker(rec: Row<"Markers">): Marker {
  const f = rec.fields;
  return {
    id: String(rec.id),
    atSec: Number(f.AtSec) || 0,
    comment: f.Comment || "",
    createdAt: f.CreatedAt || "",
  };
}

export function mapComment(rec: Row<"Comments">) {
  const f = rec.fields;
  return {
    id: String(rec.id),
    recordingPath: f.RecordingPath || null,
    startSec: Number(f.StartSec),
    endSec: Number(f.EndSec),
    text: f.Text || "",
    tags: parseTags(f.Tags),
    validated: Boolean(f.Validated),
    createdAt: f.CreatedAt || "",
    sharedFrom: f.SharedFrom || "",
  } satisfies Annotation & { recordingPath: string | null; sharedFrom: string };
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function normalizeTags(input: unknown): string[] {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  const out: string[] = [];
  for (const t of list) {
    const clean = String(t).trim().replace(/^#/, "");
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/** The folder holding a file, in the médiathèque's POSIX path space. */
export function dirOf(p: string): string {
  return String(p).split("/").slice(0, -1).join("/");
}

/** The médiathèque may already have lost it; that is not a failure worth raising. */
export async function safeRemote(remote: string): Promise<void> {
  try {
    await mediatek.remove(remote);
  } catch {
    /* already gone, or unreachable — the row is what matters */
  }
}

/** Remove a local file if it is there; a missing one is not an error. */
export function safeUnlink(p: string | null | undefined): void {
  try {
    if (p) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}
