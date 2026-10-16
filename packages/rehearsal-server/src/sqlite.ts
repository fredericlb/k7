// sqlite.ts — the rehearsal store: every row in one SQLite file, each sheet's bytes a plain file beside it.
// Rows are JSON documents keyed by collection and id, so a field schema.ts adds needs no migration.
// What reads wrong: a field a row never set reads as its type's zero value, from schema.ts — ../docs/store.md.

import { randomBytes, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

/** A store error with the HTTP status it means; the routes' error handler answers with it. */
export class DbError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DbError";
    this.status = status;
  }
}

export interface DbRecord<T = Record<string, unknown>> {
  id: string;
  fields: T;
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A 15-character id, the shape every id imported from PocketBase already has. */
function newId(): string {
  let id = "";
  for (const b of randomBytes(15)) id += ID_CHARS[b % ID_CHARS.length];
  return id;
}

const ZERO = { text: "", number: 0, bool: false };

/** What every field a row never set reads as. */
function zeroes(table: string): Record<string, unknown> {
  return Object.fromEntries(
    (SCHEMA[table] ?? []).map((f) => [f.name, ZERO[f.type]]),
  );
}

/** A filter key is written INTO the SQL, so an index on the same expression matches: a plain field name only. */
function fieldExpr(key: string): string {
  if (!/^\w+$/.test(key)) throw new DbError(400, `bad field ${key}`);
  return `json_extract(fields, '$.${key}')`;
}

/** The fields the store looks rows up by; each has an expression index, so a lookup scans no collection. */
export const INDEXED_FIELDS = [
  "Uid",
  "OwnerId",
  "SessionUid",
  "ReleaseUid",
  "MomentId",
  "SongUid",
  "SongUuid",
] as const;

/** What any id must look like: one plain segment, since ids name files. */
export const SAFE_ID = /^[\w-]+$/;

/** An id names a file, so it must be one plain segment. */
function safeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new DbError(400, `bad id ${id}`);
  return id;
}

/** SQLite's JSON reads a boolean back as 1 or 0; a bound value must match. */
const bindable = (v: unknown): string | number | null =>
  typeof v === "boolean" ? Number(v) : (v as string | number | null);

/** The store under `dir`: `k7.db` for the rows, `sheets/<id>` for each sheet's bytes. */
export function createSqlite(dir: string) {
  const sheetsDir = join(dir, "sheets");
  let db: DatabaseSync | null = null;

  // Opened on first use, never on import: a test points the folder somewhere else first.
  const open = (): DatabaseSync => {
    if (db) return db;
    mkdirSync(sheetsDir, { recursive: true });
    const next = new DatabaseSync(join(dir, "k7.db"));
    next.exec("PRAGMA journal_mode = WAL");
    next.exec(`
      CREATE TABLE IF NOT EXISTS records (
        coll   TEXT NOT NULL,
        id     TEXT NOT NULL,
        fields TEXT NOT NULL,
        PRIMARY KEY (coll, id)
      );
      CREATE TABLE IF NOT EXISTS sheets (
        id   TEXT PRIMARY KEY,
        song TEXT NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sheets_by_song ON sheets (song);
    `);
    for (const f of INDEXED_FIELDS)
      next.exec(
        `CREATE INDEX IF NOT EXISTS records_by_${f} ON records (coll, ${fieldExpr(f)})`,
      );
    db = next;
    return next;
  };

  /** Where a sheet's bytes are; the file exists once its row does. */
  const attachmentPath = (id: string): string => join(sheetsDir, safeId(id));

  /** The SELECT a filter makes, or null when an empty value list matches nothing. */
  const selectFor = (
    table: string,
    filter?: Record<string, unknown>,
  ): { sql: string; args: (string | number | null)[] } | null => {
    const where = ["coll = ?"];
    const args: (string | number | null)[] = [table];
    for (const [key, v] of Object.entries(filter ?? {})) {
      const values = Array.isArray(v) ? v : [v];
      if (!values.length) return null;
      where.push(`${fieldExpr(key)} IN (${values.map(() => "?").join(",")})`);
      args.push(...values.map(bindable));
    }
    const sql = `SELECT id, fields FROM records WHERE ${where.join(" AND ")} ORDER BY rowid`;
    return { sql, args };
  };

  /** SQLite's plan for `listRecords(table, filter)`: how a test sees an index used. */
  const planOf = (table: string, filter: Record<string, unknown>): string[] => {
    const q = selectFor(table, filter);
    if (!q) return [];
    return (
      open()
        .prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
        .all(...q.args) as { detail: string }[]
    ).map((r) => r.detail);
  };

  const listRecords = async <T = Record<string, unknown>>(
    table: string,
    filter?: Record<string, unknown>,
    opts: { fields?: string[] } = {},
  ): Promise<DbRecord<T>[]> => {
    const q = selectFor(table, filter);
    if (!q) return [];
    const rows = open()
      .prepare(q.sql)
      .all(...q.args) as { id: string; fields: string }[];
    const zero = zeroes(table);
    return rows.map(({ id, fields }) => {
      const all = { ...zero, ...JSON.parse(fields) };
      const picked = opts.fields
        ? Object.fromEntries(opts.fields.map((k) => [k, all[k]]))
        : all;
      return { id, fields: picked as T };
    });
  };

  /** Insert rows; a row may bring its own id, which is how an import keeps the references between rows. */
  const addRecords = async (
    table: string,
    fieldsList: (Record<string, unknown> & { id?: string })[],
  ): Promise<{ id: string }[]> => {
    const insert = open().prepare(
      "INSERT INTO records (coll, id, fields) VALUES (?, ?, ?)",
    );
    // Every given id checked before the first row is written, so a bad one writes none.
    const ids = fieldsList.map(({ id }) =>
      id === undefined ? newId() : safeId(String(id)),
    );
    return fieldsList.map(({ id: _, ...fields }, i) => {
      insert.run(table, ids[i], JSON.stringify(fields));
      return { id: ids[i] };
    });
  };

  const patchRecord = async (
    table: string,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<void> => {
    const d = open();
    const row = d
      .prepare("SELECT fields FROM records WHERE coll = ? AND id = ?")
      .get(table, id) as { fields: string } | undefined;
    if (!row) throw new DbError(404, `${table}/${id}: not found`);
    d.prepare("UPDATE records SET fields = ? WHERE coll = ? AND id = ?").run(
      JSON.stringify({ ...JSON.parse(row.fields), ...fields }),
      table,
      id,
    );
  };

  const deleteAttachment = async (attachmentId: string): Promise<void> => {
    open().prepare("DELETE FROM sheets WHERE id = ?").run(attachmentId);
    rmSync(attachmentPath(attachmentId), { force: true });
  };

  const deleteRecords = async (table: string, ids: string[]): Promise<void> => {
    const d = open();
    const del = d.prepare("DELETE FROM records WHERE coll = ? AND id = ?");
    const sheetsOf = d.prepare("SELECT id FROM sheets WHERE song = ?");
    for (const id of ids) {
      del.run(table, id);
      // A song takes its sheets with it.
      if (table === "Songs")
        for (const s of sheetsOf.all(id) as { id: string }[])
          await deleteAttachment(s.id);
    }
  };

  /** Keep one sheet's bytes — a buffer, or a file on disk copied — for `songId`, the file first: a row never names a file that is not there. */
  const uploadAttachment = async (
    bytes: Buffer | { file: string },
    mime: string,
    filename: string,
    songId: string,
    id: string = newId(),
  ): Promise<string> => {
    const at = attachmentPath(id);
    open();
    const tmp = `${at}.${randomUUID()}.part`;
    if (Buffer.isBuffer(bytes)) writeFileSync(tmp, bytes);
    else copyFileSync(bytes.file, tmp);
    renameSync(tmp, at);
    open()
      // REPLACE: an import that failed halfway writes the same ids again.
      .prepare(
        "INSERT OR REPLACE INTO sheets (id, song, name, mime) VALUES (?, ?, ?, ?)",
      )
      .run(id, songId, filename, mime);
    return id;
  };

  /** The file of a sheet this store holds, or null. */
  const attachmentFile = (attachmentId: string): string | null => {
    const known = open()
      .prepare("SELECT 1 FROM sheets WHERE id = ?")
      .get(attachmentId);
    const at = attachmentPath(attachmentId);
    return known && existsSync(at) ? at : null;
  };

  /** Run `fn` as one transaction: every row it writes lands, or none does. */
  const inTransaction = async (fn: () => Promise<void>): Promise<void> => {
    const d = open();
    d.exec("BEGIN");
    try {
      await fn();
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
  };

  /** Whether the store holds no row at all: what an import waits for. */
  const isEmpty = (): boolean =>
    !open().prepare("SELECT 1 FROM records LIMIT 1").get();

  return {
    planOf,
    listRecords,
    addRecords,
    patchRecord,
    deleteRecords,
    uploadAttachment,
    attachmentFile,
    deleteAttachment,
    isEmpty,
    inTransaction,
  };
}
