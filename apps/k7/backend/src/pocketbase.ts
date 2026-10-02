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

// One path segment, encoded: an id from a URL must never reach ANOTHER PocketBase endpoint through a `../`, with a superuser's token behind it.
const seg = (s: string): string => encodeURIComponent(s);

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

  const signal = () =>
    timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {};

  // Superuser auth token, re-fetched well before it would expire — and shared, so a burst of requests signs in once.
  let authing: Promise<string> | null = null;
  async function authenticate(): Promise<string> {
    if (authToken && authExp > Date.now()) return authToken;
    authing ??= signIn().finally(() => {
      authing = null;
    });
    return authing;
  }

  async function signIn(): Promise<string> {
    const res = await fetch(
      `${base}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
        ...signal(),
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
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    };
    if (
      init.body &&
      !(init.body instanceof FormData) &&
      !headers["Content-Type"]
    ) {
      headers["Content-Type"] = "application/json";
    }
    let res = await fetch(`${base}${path}`, { ...init, headers, ...signal() });
    // A token PocketBase no longer accepts — its instance reset, the superuser's key rotated — is re-signed ONCE rather than failing every call until it would expire.
    if (res.status === 401 && !init.skipAuth) {
      authToken = null;
      headers.Authorization = `Bearer ${await authenticate()}`;
      res = await fetch(`${base}${path}`, { ...init, headers, ...signal() });
    }
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

  // An IN-list longer than this is asked in several queries: a filter is a GET query string, and PocketBase caps its length (docs/pocketbase.md).
  const IN_CHUNK = 40;

  const listRecords = async <T = Record<string, unknown>>(
    table: string,
    filter?: Record<string, unknown>,
    opts: { fields?: string[] } = {},
  ): Promise<PbRecord<T>[]> => {
    const longest = Object.entries(filter ?? {}).find(
      ([, v]) => Array.isArray(v) && v.length > IN_CHUNK,
    );
    if (longest) {
      const [key, values] = longest as [string, unknown[]];
      const out: PbRecord<T>[] = [];
      for (let i = 0; i < values.length; i += IN_CHUNK)
        out.push(
          ...(await listRecords<T>(
            table,
            { ...filter, [key]: values.slice(i, i + IN_CHUNK) },
            opts,
          )),
        );
      return out;
    }
    const filterQ = filterToQuery(filter);
    const out: PbRecord<T>[] = [];
    let page = 1;
    for (;;) {
      const q = new URLSearchParams({ page: String(page), perPage: "500" });
      if (filterQ) q.set("filter", filterQ);
      // A projection, when the caller needs a few fields of rows that carry a large one — a session's envelope is past 100 KB.
      if (opts.fields) q.set("fields", ["id", ...opts.fields].join(","));
      const res = await pbFetch(`/api/collections/${seg(table)}/records?${q}`);
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
      const res = await pbFetch(`/api/collections/${seg(table)}/records`, {
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
    await pbFetch(`/api/collections/${seg(table)}/records/${seg(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  };

  const deleteRecords = async (table: string, ids: string[]): Promise<void> => {
    for (const id of ids) {
      await pbFetch(`/api/collections/${seg(table)}/records/${seg(id)}`, {
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
      `/api/collections/song_sheets/records/${seg(attachmentId)}`,
    );
    const { file } = (await rec.json()) as { file: string };
    const res = await pbFetch(
      `/api/files/song_sheets/${seg(attachmentId)}/${seg(file)}`,
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
  ): Promise<{
    id: string;
    fields: ({ id: string; name: string } & Record<string, unknown>)[];
  } | null> => {
    const res = await pbFetch(
      `/api/collections?perPage=200&filter=${encodeURIComponent(`name = "${name}"`)}`,
    );
    const data = (await res.json()) as {
      items: {
        id: string;
        fields: ({ id: string; name: string } & Record<string, unknown>)[];
      }[];
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
    // A JSON envelope for an hours-long session can run past 100 KB, and
    // max: 0 turned out to still enforce PocketBase's 5000-character default
    // rather than lifting it — so every text field gets an explicit, generous
    // ceiling instead (5 MB: far past any real envelope, but not "no limit").
    if (f.type === "text") {
      return {
        name: f.name,
        type: "text",
        required: Boolean(f.required),
        max: 5_000_000,
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
        // No "id" field here: PocketBase provisions its own primary key.
        // Declaring one ourselves turns it into a required, caller-supplied
        // field instead — every insert then 400s with "id: Cannot be blank".
        fields: fields.map(asPbField),
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
    await pbFetch(`/api/collections/${seg(collectionId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: [
          ...existingFields,
          ...missing.filter((f) => !have.has(f.name)).map(asPbField),
        ],
      }),
    });
  };

  // Escape hatch: replaces a collection's whole fields array as given, no
  // mapping through FieldSpec. For fixing a field's raw shape by hand —
  // addMissingFields can only append, never correct one already there.
  const setFields = async (
    collectionId: string,
    fields: Record<string, unknown>[],
  ): Promise<void> => {
    await pbFetch(`/api/collections/${seg(collectionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
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
    setFields,
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
