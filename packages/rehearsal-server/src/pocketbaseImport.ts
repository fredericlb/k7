// pocketbaseImport.ts — the one-time move of the server's rows out of PocketBase into the store.
// Runs at boot when POCKETBASE_* are set and none of its rows is here yet; ids are kept, so every reference holds.
// What reads wrong: it only READS PocketBase, which stays untouched until removed by hand — ../docs/store.md.

import { SCHEMA } from "./schema.ts";
import type { createSqlite } from "./sqlite.ts";

export interface PocketbaseSource {
  url: string;
  email: string;
  password: string;
}

type Store = ReturnType<typeof createSqlite>;

/** A superuser's read-only view of one PocketBase: every record of a collection, and a record's file. */
async function reader(src: PocketbaseSource) {
  const base = src.url.replace(/\/+$/, "");
  const auth = await fetch(
    `${base}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: src.email, password: src.password }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  // PocketBase's own message ("Failed to authenticate.") says whether it is the pair or the request.
  if (!auth.ok)
    throw new Error(
      `PocketBase sign-in as ${src.email}: ${auth.status} ${(await auth.text().catch(() => "")).slice(0, 200)}`,
    );
  const { token } = (await auth.json()) as { token: string };
  const get = async (path: string): Promise<Response> => {
    const res = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`PocketBase GET ${path}: ${res.status}`);
    return res;
  };
  const enc = encodeURIComponent;
  return {
    async records(coll: string): Promise<Record<string, unknown>[]> {
      const out: Record<string, unknown>[] = [];
      for (let page = 1; ; page++) {
        const data = (await (
          await get(
            // By id: these collections have no `created` field, and PocketBase refuses a sort on one with a 400.
            `/api/collections/${enc(coll)}/records?page=${page}&perPage=500&sort=id`,
          )
        ).json()) as { items: Record<string, unknown>[]; totalPages: number };
        out.push(...data.items);
        if (page >= data.totalPages) return out;
      }
    },
  };
}

/** Copy every collection schema.ts names; the counts per collection, or null when a PocketBase row is already here. */
export async function importFromPocketbase(
  src: PocketbaseSource,
  store: Store,
): Promise<Record<string, number> | null> {
  const pb = await reader(src);
  const counts: Record<string, number> = {};
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const coll of Object.keys(SCHEMA)) rows[coll] = await pb.records(coll);
  // Ids are kept, so one of them already in the store means an earlier boot imported; rows written since don't count.
  const done = Object.entries(rows).some(([coll, items]) =>
    items.some((item) => store.getRecord(coll, String(item.id))),
  );
  if (done) return null;
  // In one transaction: no PocketBase row lands unless every one does, and none here is what makes the next boot retry.
  store.inTransaction(() => {
    for (const [coll, items] of Object.entries(rows)) {
      const names = new Set(SCHEMA[coll].map((f) => f.name));
      store.addRecords(
        coll,
        items.map((item) => ({
          id: String(item.id),
          // Only what schema.ts names: PocketBase's own columns (created, collectionId…) stay behind.
          ...Object.fromEntries(
            Object.entries(item).filter(([k]) => names.has(k)),
          ),
        })),
      );
      counts[coll] = items.length;
    }
  });
  return counts;
}
