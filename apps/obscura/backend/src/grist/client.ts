// obscura's view of its Grist doc. The transport (auth, errors, retries on
// nothing, SQL, user actions) is @frediverse/db-grist; this class only adapts
// it to the shapes grist.go's GristClient exposed, which the loader, the editor
// and the state persister are written against.

import type { GristRecord } from "@frediverse/db-grist";
import {
  createGrist,
  type GristClient as SharedGrist,
} from "@frediverse/db-grist";
import type { GristConfig } from "../config.ts";

export type { GristRecord } from "@frediverse/db-grist";

export type GristFields = Record<string, unknown>;

const TIMEOUT_MS = 60_000;

export class GristClient {
  private g: SharedGrist;

  constructor(cfg: GristConfig) {
    this.g = createGrist({
      apiUrl: cfg.url,
      docId: cfg.docId,
      apiKey: cfg.apiKey,
      timeoutMs: TIMEOUT_MS,
      // grist.go never required a key: a keyless Grist is a supported setup
      // here (and what the tests' stub server runs as).
      allowAnonymous: true,
    });
  }

  /** Fetch all records of a table, optionally filtered. */
  listRecords(
    table: string,
    filter?: Record<string, unknown>,
  ): Promise<GristRecord[]> {
    return this.g.listRecords(table, filter);
  }

  /** Insert records; returns the created row ids in insertion order. */
  async addRecords(table: string, fields: GristFields[]): Promise<number[]> {
    const created = await this.g.addRecords(table, fields);
    return created.map((r) => r.id);
  }

  /** Patch existing rows by id. */
  updateRecords(
    table: string,
    updates: Map<number, GristFields>,
  ): Promise<void> {
    return this.g.patchRecords(
      table,
      [...updates].map(([id, fields]) => ({ id, fields })),
    );
  }

  /** Upload one file as an Attachment; returns the new attachment row id. */
  uploadAttachment(filename: string, data: Buffer): Promise<number> {
    return this.g.uploadAttachment(data, "", filename);
  }

  /** Download the binary content of an attachment by id. */
  downloadAttachment(attId: number): Promise<Buffer> {
    return this.g.downloadAttachment(attId);
  }

  /** List the table ids in the doc. */
  listTables(): Promise<string[]> {
    return this.g.listTables();
  }

  /** List the column ids on a table (schema bootstrap reconciliation). */
  listColumns(table: string): Promise<string[]> {
    return this.g.listColumns(table);
  }

  /** Run a read-only SELECT against the doc. */
  runSql(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]> {
    return this.g.runSql(sql, args);
  }

  /**
   * Map attachment row id → fileIdent (Grist's content-addressed
   * "<sha256>.<ext>") for the requested ids. Chunked to stay under SQLite's
   * parameter cap.
   */
  async attachmentFileIdents(ids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const CHUNK = 500;
    for (let start = 0; start < ids.length; start += CHUNK) {
      const batch = ids.slice(start, start + CHUNK);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await this.runSql(
        `SELECT id, fileIdent FROM _grist_Attachments WHERE id IN (${placeholders})`,
        batch,
      );
      for (const r of rows) {
        const id = typeof r.id === "number" ? r.id : 0;
        const ident = typeof r.fileIdent === "string" ? r.fileIdent : "";
        if (id > 0 && ident !== "") out.set(id, ident);
      }
    }
    return out;
  }

  /**
   * Remove rows by id. Goes through BulkRemoveRecord rather than the shared
   * client's /data/delete — the doc's own audited action path, matching what
   * grist.go did. No-op for empty ids.
   */
  async deleteRecords(table: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.apply([["BulkRemoveRecord", table, ids]]);
  }

  /** Submit raw user actions, e.g. ["AddTable", "Name", [{id, type}, …]]. */
  apply(actions: unknown[][]): Promise<void> {
    return this.g.apply(actions);
  }
}

/**
 * Encode a list of row ids as Grist's RefList wire format — a leading "L"
 * sentinel followed by the ids (grist.go's gristIDList).
 */
export function gristIdList(...ids: number[]): unknown[] {
  return ["L", ...ids];
}
