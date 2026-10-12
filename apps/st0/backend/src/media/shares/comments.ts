// comments.ts — what visitors wrote on a frozen snapshot, in SQLite. The only database in this
// service, and the reason is concurrency: a comment arrives from anyone holding a link, so a
// read-modify-write over a JSON file silently drops one. See ../../../docs/media/comments.md.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CommentCounts,
  CommentState,
  ShareComment,
} from "@studio/web-protocol";
import { sharesDir } from "./store.ts";

/** A body longer than this is not a comment, and the public route is unauthenticated. */
export const MAX_BODY = 4000;
/** A name is a label on a row, not a field to hide a payload in. */
export const MAX_AUTHOR = 80;
/** Per snapshot, and the ceiling is the point: an open write verb needs one that is not disk. */
export const MAX_PER_SHARE = 500;

const STATES: readonly CommentState[] = ["active", "resolved", "ignored"];

export const isState = (s: string): s is CommentState =>
  (STATES as readonly string[]).includes(s);

let db: DatabaseSync | null = null;

/** Opened on first use, never on import: a test points STUDIO_SHARES_DIR somewhere else first. */
function open(): DatabaseSync {
  if (db) return db;
  const dir = sharesDir();
  mkdirSync(dir, { recursive: true });
  const next = new DatabaseSync(join(dir, "comments.db"));
  // WAL, because the reader is the public route and the writer is the author's: neither may block the other.
  next.exec("PRAGMA journal_mode = WAL");
  next.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      share_key  TEXT    NOT NULL,
      author     TEXT    NOT NULL DEFAULT '',
      body       TEXT    NOT NULL,
      at_seconds REAL,
      state      TEXT    NOT NULL DEFAULT 'active',
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_by_share ON comments (share_key, id);
  `);
  db = next;
  return next;
}

/** Between two tests, and nowhere else: the next call reopens on whatever directory is set then. */
export function closeComments(): void {
  db?.close();
  db = null;
}

interface Row {
  id: number;
  author: string;
  body: string;
  at_seconds: number | null;
  state: string;
  created_at: string;
  updated_at: string;
}

const toComment = (r: Row): ShareComment => ({
  id: r.id,
  author: r.author,
  body: r.body,
  at: r.at_seconds,
  state: isState(r.state) ? r.state : "active",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Every comment on one snapshot, oldest first — a thread reads down, and a timecode is not an order. */
export function listComments(key: string): ShareComment[] {
  const rows = open()
    .prepare(
      `SELECT id, author, body, at_seconds, state, created_at, updated_at
         FROM comments WHERE share_key = ? ORDER BY id ASC`,
    )
    .all(key) as unknown as Row[];
  return rows.map(toComment);
}

export function countComments(key: string): number {
  const row = open()
    .prepare("SELECT COUNT(*) AS n FROM comments WHERE share_key = ?")
    .get(key) as unknown as { n: number };
  return row?.n ?? 0;
}

/** The three sizes for one snapshot, in one pass — what the author's tabs and the row's badge show. */
export function countsFor(key: string): CommentCounts {
  const rows = open()
    .prepare(
      "SELECT state, COUNT(*) AS n FROM comments WHERE share_key = ? GROUP BY state",
    )
    .all(key) as unknown as { state: string; n: number }[];
  const counts: CommentCounts = { active: 0, resolved: 0, ignored: 0 };
  for (const r of rows) if (isState(r.state)) counts[r.state] = r.n;
  return counts;
}

export function addComment(
  key: string,
  c: { author: string; body: string; at: number | null },
): ShareComment {
  const now = new Date().toISOString();
  const at = c.at !== null && Number.isFinite(c.at) ? Math.max(0, c.at) : null;
  const res = open()
    .prepare(
      `INSERT INTO comments (share_key, author, body, at_seconds, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(key, c.author, c.body, at, now, now);
  return {
    id: Number(res.lastInsertRowid),
    author: c.author,
    body: c.body,
    at,
    state: "active",
    createdAt: now,
    updatedAt: now,
  };
}

/** Move one comment between the three states. False when it is not on this snapshot. */
export function setCommentState(
  key: string,
  id: number,
  state: CommentState,
): boolean {
  const res = open()
    .prepare(
      "UPDATE comments SET state = ?, updated_at = ? WHERE id = ? AND share_key = ?",
    )
    .run(state, new Date().toISOString(), id, key);
  return Number(res.changes) > 0;
}

/** A change token over several snapshots, folded into the poll the author's list already runs. */
export function commentsStamp(keys: readonly string[]): string {
  if (keys.length === 0) return "0:";
  const marks = keys.map(() => "?").join(",");
  const row = open()
    .prepare(
      `SELECT COUNT(*) AS n, MAX(updated_at) AS at
         FROM comments WHERE share_key IN (${marks})`,
    )
    .get(...keys) as unknown as { n: number; at: string | null };
  return `${row?.n ?? 0}:${row?.at ?? ""}`;
}
