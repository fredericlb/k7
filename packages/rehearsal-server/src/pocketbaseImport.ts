// pocketbaseImport.ts — the one-time move of the server's rows and sheets out of PocketBase into the store.
// Runs at boot when POCKETBASE_* are set and the store holds no row; ids are kept, so every reference holds.
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
  if (!auth.ok) throw new Error(`PocketBase sign-in: ${auth.status}`);
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
            `/api/collections/${enc(coll)}/records?page=${page}&perPage=500&sort=created`,
          )
        ).json()) as { items: Record<string, unknown>[]; totalPages: number };
        out.push(...data.items);
        if (page >= data.totalPages) return out;
      }
    },
    async file(coll: string, id: string, name: string): Promise<Buffer> {
      const res = await get(`/api/files/${enc(coll)}/${enc(id)}/${enc(name)}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Copy every collection schema.ts names, then every sheet with its bytes; the counts, per collection. */
export async function importFromPocketbase(
  src: PocketbaseSource,
  store: Store,
): Promise<Record<string, number>> {
  const pb = await reader(src);
  const counts: Record<string, number> = {};
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const coll of Object.keys(SCHEMA)) rows[coll] = await pb.records(coll);
  const sheets = await pb.records("song_sheets");
  // One sheet at a time and before any row: a sheet written again on a retry replaces itself.
  for (const s of sheets)
    await store.uploadAttachment(
      await pb.file("song_sheets", String(s.id), String(s.file)),
      String(s.mime || "application/octet-stream"),
      String(s.name || s.file),
      String(s.song),
      String(s.id),
    );
  // In one transaction: the store stays empty unless every row landed, and an empty store is what makes the next boot retry.
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
  counts.song_sheets = sheets.length;
  return counts;
}
