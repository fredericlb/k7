// This app's PocketBase instance: a hand-rolled REST client (no SDK dependency,
// same style as the old db-grist), bound to POCKETBASE_URL / _EMAIL / _PASSWORD
// and spread into the free functions store.ts calls. One thing that does NOT
// carry over from Grist: ids are opaque strings here, not numbers.

import { env } from "./env.ts";

export class PocketbaseError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PocketbaseError";
    this.status = status;
  }
}

export interface PbRecord<T = Record<string, unknown>> {
  id: string;
  fields: T;
}

export interface FieldSpec {
  name: string;
  type: "text" | "number" | "bool" | "relation" | "file";
  required?: boolean;
  // Relation target collection id, for type "relation".
  collectionId?: string;
  cascadeDelete?: boolean;
}

export type CollectionSchema = Record<string, FieldSpec[]>;

interface PbConfig {
  url?: string;
  email?: string;
  password?: string;
  timeoutMs?: number;
}

function escapeFilterValue(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// PocketBase filter syntax: `Field = "v1" || Field = "v2"`. Grist's filter shape
// is {col: [v1, v2]} meaning col IN (v1, v2) — translate every value to an OR.
function filterToQuery(filter?: Record<string, unknown>): string {
  if (!filter || !Object.keys(filter).length) return "";
  const clauses = Object.entries(filter).map(([k, v]) => {
    const values = Array.isArray(v) ? v : [v];
    if (!values.length) return "false";
    const ors = values.map((val) => `${k} = ${escapeFilterValue(val)}`);
    return ors.length > 1 ? `(${ors.join(" || ")})` : ors[0];
  });
  return clauses.join(" && ");
}

/**
 * Build a client for one PocketBase instance. Returned as plain closures so
 * callers can destructure them into free functions, same as db-grist. An
 * unconfigured client is legal — isConfigured() reports it and every call
 * throws — so the backend can boot without PocketBase and degrade instead of
 * crashing.
 */
export function createPocketbase({
  url,
  email,
  password,
  timeoutMs,
}: PbConfig) {
  const base = url ? url.replace(/\/+$/, "") : null;
  const isConfigured = (): boolean =>
    Boolean(base) && Boolean(email) && Boolean(password);

  let authToken: string | null = null;
  let authExp = 0;

  // Superuser auth token, re-fetched well before it would expire.
  async function authenticate(): Promise<string> {
    if (authToken && authExp > Date.now()) return authToken;
    const res = await fetch(
      `${base}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
      },
    );
    if (!res.ok) {
      throw new PocketbaseError(
        res.status,
        `Pocketbase auth failed: ${res.status}`,
      );
    }
    const data = (await res.json()) as { token: string };
    authToken = data.token;
    authExp = Date.now() + 12 * 60 * 60 * 1000; // refresh well inside the token's lifetime
    return authToken;
  }

  async function pbFetch(
    path: string,
    init: RequestInit & { skipAuth?: boolean } = {},
  ): Promise<Response> {
    if (!isConfigured()) {
      throw new PocketbaseError(
        503,
        "Pocketbase is not configured — set POCKETBASE_URL, POCKETBASE_EMAIL and POCKETBASE_PASSWORD",
      );
    }
    const token = await authenticate();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    };
    if (
      init.body &&
      !(init.body instanceof FormData) &&
      !headers["Content-Type"]
    ) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PocketbaseError(
        res.status,
        `Pocketbase ${init.method || "GET"} ${path} → ${res.status} ${text}`,
      );
    }
    return res;
  }

  // --- Records ---------------------------------------------------------------

  const listRecords = async <T = Record<string, unknown>>(
    table: string,
    filter?: Record<string, unknown>,
  ): Promise<PbRecord<T>[]> => {
    const filterQ = filterToQuery(filter);
    const out: PbRecord<T>[] = [];
    let page = 1;
    for (;;) {
      const q = new URLSearchParams({ page: String(page), perPage: "500" });
      if (filterQ) q.set("filter", filterQ);
      const res = await pbFetch(`/api/collections/${table}/records?${q}`);
      const data = (await res.json()) as {
        items: Record<string, unknown>[];
        totalPages: number;
      };
      for (const item of data.items) {
        const { id, collectionId, collectionName, ...fields } = item as {
          id: string;
          collectionId?: string;
          collectionName?: string;
        } & Record<string, unknown>;
        out.push({ id, fields: fields as T });
      }
      if (page >= data.totalPages) break;
      page++;
    }
    return out;
  };

  const addRecords = async (
    table: string,
    fieldsList: Record<string, unknown>[],
  ): Promise<{ id: string }[]> => {
    const out: { id: string }[] = [];
    for (const fields of fieldsList) {
      const res = await pbFetch(`/api/collections/${table}/records`, {
        method: "POST",
        body: JSON.stringify(fields),
      });
      out.push({ id: ((await res.json()) as { id: string }).id });
    }
    return out;
  };

  const patchRecord = async (
    table: string,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<void> => {
    await pbFetch(`/api/collections/${table}/records/${id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  };

  const deleteRecords = async (table: string, ids: string[]): Promise<void> => {
    for (const id of ids) {
      await pbFetch(`/api/collections/${table}/records/${id}`, {
        method: "DELETE",
      });
    }
  };

  // --- Attachments (a dedicated song_sheets collection) -----------------------

  const uploadAttachment = async (
    buffer: Buffer,
    mime: string,
    filename: string,
    songId: string,
  ): Promise<string> => {
    const form = new FormData();
    form.append("song", songId);
    form.append("name", filename);
    form.append("mime", mime);
    form.append("file", new Blob([buffer], { type: mime }), filename);
    const res = await pbFetch(`/api/collections/song_sheets/records`, {
      method: "POST",
      body: form,
    });
    return ((await res.json()) as { id: string }).id;
  };

  const downloadAttachment = async (attachmentId: string): Promise<Buffer> => {
    const rec = await pbFetch(
      `/api/collections/song_sheets/records/${attachmentId}`,
    );
    const { file } = (await rec.json()) as { file: string };
    const res = await pbFetch(
      `/api/files/song_sheets/${attachmentId}/${encodeURIComponent(file)}`,
    );
    return Buffer.from(await res.arrayBuffer());
  };

  const deleteAttachment = (attachmentId: string): Promise<void> =>
    deleteRecords("song_sheets", [attachmentId]);

  // --- Schema (what the migration runner drives) ------------------------------

  const listCollectionNames = async (): Promise<string[]> => {
    const res = await pbFetch(`/api/collections?perPage=200&fields=name`);
    const data = (await res.json()) as { items: { name: string }[] };
    return data.items.map((c) => c.name);
  };

  const getCollection = async (
    name: string,
  ): Promise<{ id: string; fields: { id: string; name: string }[] } | null> => {
    const res = await pbFetch(
      `/api/collections?perPage=200&filter=${encodeURIComponent(`name = "${name}"`)}`,
    );
    const data = (await res.json()) as {
      items: { id: string; fields: { id: string; name: string }[] }[];
    };
    return data.items[0] || null;
  };

  const asPbField = (f: FieldSpec): Record<string, unknown> => {
    if (f.type === "relation") {
      return {
        name: f.name,
        type: "relation",
        required: Boolean(f.required),
        collectionId: f.collectionId,
        cascadeDelete: Boolean(f.cascadeDelete),
        maxSelect: 1,
      };
    }
    if (f.type === "file") {
      return {
        name: f.name,
        type: "file",
        required: Boolean(f.required),
        maxSelect: 1,
      };
    }
    return { name: f.name, type: f.type, required: Boolean(f.required) };
  };

  const createCollection = async (
    name: string,
    fields: FieldSpec[],
  ): Promise<void> => {
    await pbFetch(`/api/collections`, {
      method: "POST",
      body: JSON.stringify({
        name,
        type: "base",
        fields: [
          { name: "id", type: "text", primaryKey: true },
          ...fields.map(asPbField),
        ],
      }),
    });
  };

  // Never drops or retypes an existing field — only appends what's missing.
  const addMissingFields = async (
    collectionId: string,
    existingFields: { name: string }[],
    missing: FieldSpec[],
  ): Promise<void> => {
    if (!missing.length) return;
    const have = new Set(existingFields.map((f) => f.name));
    await pbFetch(`/api/collections/${collectionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: [
          ...existingFields,
          ...missing.filter((f) => !have.has(f.name)).map(asPbField),
        ],
      }),
    });
  };

  return {
    isConfigured,
    listRecords,
    addRecords,
    patchRecord,
    deleteRecords,
    uploadAttachment,
    downloadAttachment,
    deleteAttachment,
    listCollectionNames,
    getCollection,
    createCollection,
    addMissingFields,
  };
}

export const pocketbase = createPocketbase(env.pocketbase);

export const {
  isConfigured,
  listRecords,
  addRecords,
  patchRecord,
  deleteRecords,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
} = pocketbase;
