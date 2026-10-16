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
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

/** A store error with the HTTP status it means; the routes' error handler answers with it. */
class DbError extends Error {
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

/** Whether a field holds more than whitespace, computed in SQL so its text never leaves the database. */
const filledExpr = (key: string): string =>
  `(trim(coalesce(${fieldExpr(key)}, ''), ' ' || char(9, 10, 13)) <> '')`;

/** The schema's type of a field, to read SQLite's 1/0 back as a boolean. */
function typeOf(table: string, key: string): string | undefined {
  return SCHEMA[table]?.find((f) => f.name === key)?.type;
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

/** What a listing reads: whole rows, or only the named fields, and whether others hold any text. */
export interface ListOptions {
  /** Read only these fields, each extracted in SQL: the rest of the row is never parsed. */
  fields?: string[];
  /** Read these fields as booleans, true when they hold more than whitespace. */
  filled?: string[];
}

type Bound = string | number | null;

/** The store under `dir`: `k7.db` for the rows, `sheets/<id>` for each sheet's bytes; every call is synchronous. */
export function createSqlite(dir: string) {
  const sheetsDir = join(dir, "sheets");
  let db: DatabaseSync | null = null;
  const statements = new Map<string, StatementSync>();
  // How many inTransaction calls are open: an inner one joins the outer transaction.
  let depth = 0;

  // Opened on first use, never on import: a test points the folder somewhere else first.
  const open = (): DatabaseSync => {
    if (db) return db;
    mkdirSync(sheetsDir, { recursive: true });
    const next = new DatabaseSync(join(dir, "k7.db"));
    next.exec("PRAGMA journal_mode = WAL");
    // Safe under WAL: a power cut may lose the last commits, never corrupt the file — ../docs/store.md.
    next.exec("PRAGMA synchronous = NORMAL");
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

  /** The prepared statement for `sql`, prepared once: the SQL texts are few and fixed by their shape. */
  const stmt = (sql: string): StatementSync => {
    let s = statements.get(sql);
    if (!s) {
      s = open().prepare(sql);
      statements.set(sql, s);
    }
    return s;
  };

  /** Where a sheet's bytes are; the file exists once its row does. */
  const attachmentPath = (id: string): string => join(sheetsDir, safeId(id));

  /** Run `fn` as one transaction: every row it writes lands, or none does; it must not await. */
  const inTransaction = <T>(fn: () => T): T => {
    const d = open();
    if (depth > 0) return fn();
    d.exec("BEGIN");
    depth++;
    try {
      const out = fn();
      // An await inside would let other requests' writes join this transaction.
      if (out && typeof (out as { then?: unknown }).then === "function")
        throw new TypeError("inTransaction takes a synchronous function");
      d.exec("COMMIT");
      return out;
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
    }
  };

  /** The SELECT a filter makes, or null when an empty value list matches nothing. */
  const selectFor = (
    table: string,
    filter?: Record<string, unknown>,
    opts: ListOptions = {},
  ): { sql: string; args: Bound[] } | null => {
    const where = ["coll = ?"];
    const args: Bound[] = [table];
    for (const [key, v] of Object.entries(filter ?? {})) {
      const values = Array.isArray(v) ? v : [v];
      if (!values.length) return null;
      where.push(`${fieldExpr(key)} IN (${values.map(() => "?").join(",")})`);
      args.push(...values.map(bindable));
    }
    const columns = ["id"];
    if (!opts.fields) columns.push("fields");
    else
      opts.fields.forEach((f, i) => {
        columns.push(`${fieldExpr(f)} AS f${i}`);
      });
    (opts.filled ?? []).forEach((f, i) => {
      columns.push(`${filledExpr(f)} AS b${i}`);
    });
    const sql = `SELECT ${columns.join(", ")} FROM records WHERE ${where.join(" AND ")} ORDER BY rowid`;
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

  /** The rows a filter matches, oldest first; with `fields`, only those, read in SQL. */
  const listRecords = <T = Record<string, unknown>>(
    table: string,
    filter?: Record<string, unknown>,
    opts: ListOptions = {},
  ): DbRecord<T>[] => {
    const q = selectFor(table, filter, opts);
    if (!q) return [];
    const rows = stmt(q.sql).all(...q.args) as Record<string, unknown>[];
    const zero = zeroes(table);
    const filled = opts.filled ?? [];
    const { fields } = opts;
    return rows.map((row) => {
      const out: Record<string, unknown> = fields
        ? Object.fromEntries(
            fields.map((k, i) => {
              const v = row[`f${i}`];
              if (v === null || v === undefined) return [k, zero[k]];
              return [k, typeOf(table, k) === "bool" ? Boolean(v) : v];
            }),
          )
        : { ...zero, ...JSON.parse(String(row.fields)) };
      filled.forEach((k, i) => {
        out[k] = Boolean(row[`b${i}`]);
      });
      return { id: String(row.id), fields: out as T };
    });
  };

  /** One row by its primary key, or null: no index on a field, no scan. */
  const getRecord = <T = Record<string, unknown>>(
    table: string,
    id: string,
  ): DbRecord<T> | null => {
    const row = stmt(
      "SELECT fields FROM records WHERE coll = ? AND id = ?",
    ).get(table, String(id)) as { fields: string } | undefined;
    if (!row) return null;
    return {
      id: String(id),
      fields: { ...zeroes(table), ...JSON.parse(row.fields) } as T,
    };
  };

  /** Insert rows in one transaction; a row may bring its own id, which is how an import keeps the references between rows. */
  const addRecords = (
    table: string,
    fieldsList: (Record<string, unknown> & { id?: string })[],
  ): { id: string }[] => {
    // Every given id checked before the first row is written, so a bad one writes none.
    const ids = fieldsList.map(({ id }) =>
      id === undefined ? newId() : safeId(String(id)),
    );
    const insert = stmt(
      "INSERT INTO records (coll, id, fields) VALUES (?, ?, ?)",
    );
    return inTransaction(() =>
      fieldsList.map(({ id: _, ...fields }, i) => {
        insert.run(table, ids[i], JSON.stringify(fields));
        return { id: ids[i] };
      }),
    );
  };

  const patchRecord = (
    table: string,
    id: string,
    fields: Record<string, unknown>,
  ): void => {
    const row = stmt(
      "SELECT fields FROM records WHERE coll = ? AND id = ?",
    ).get(table, id) as { fields: string } | undefined;
    if (!row) throw new DbError(404, `${table}/${id}: not found`);
    stmt("UPDATE records SET fields = ? WHERE coll = ? AND id = ?").run(
      JSON.stringify({ ...JSON.parse(row.fields), ...fields }),
      table,
      id,
    );
  };

  const deleteAttachment = (attachmentId: string): void => {
    stmt("DELETE FROM sheets WHERE id = ?").run(attachmentId);
    rmSync(attachmentPath(attachmentId), { force: true });
  };

  /** Delete rows in one transaction; a song takes its sheets, whose files go once the rows are gone. */
  const deleteRecords = (table: string, ids: string[]): void => {
    const files: string[] = [];
    inTransaction(() => {
      const del = stmt("DELETE FROM records WHERE coll = ? AND id = ?");
      for (const id of ids) {
        del.run(table, id);
        if (table !== "Songs") continue;
        const sheets = stmt("SELECT id FROM sheets WHERE song = ?").all(id) as {
          id: string;
        }[];
        for (const s of sheets) {
          stmt("DELETE FROM sheets WHERE id = ?").run(s.id);
          files.push(attachmentPath(s.id));
        }
      }
    });
    for (const f of files) rmSync(f, { force: true });
  };

  /** Keep one sheet's bytes — a buffer, or a file on disk copied — for `songId`, the file first: a row never names a file that is not there. */
  const uploadAttachment = (
    bytes: Buffer | { file: string },
    mime: string,
    filename: string,
    songId: string,
    id: string = newId(),
  ): string => {
    const at = attachmentPath(id);
    open();
    const tmp = `${at}.${randomUUID()}.part`;
    if (Buffer.isBuffer(bytes)) writeFileSync(tmp, bytes);
    else copyFileSync(bytes.file, tmp);
    renameSync(tmp, at);
    // REPLACE: an import that failed halfway writes the same ids again.
    stmt(
      "INSERT OR REPLACE INTO sheets (id, song, name, mime) VALUES (?, ?, ?, ?)",
    ).run(id, songId, filename, mime);
    return id;
  };

  /** The file of a sheet this store holds, or null. */
  const attachmentFile = (attachmentId: string): string | null => {
    const known = stmt("SELECT 1 FROM sheets WHERE id = ?").get(attachmentId);
    const at = attachmentPath(attachmentId);
    return known && existsSync(at) ? at : null;
  };

  /** Whether the store holds no row at all: what an import waits for. */
  const isEmpty = (): boolean => !stmt("SELECT 1 FROM records LIMIT 1").get();

  return {
    planOf,
    listRecords,
    getRecord,
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
