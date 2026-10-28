// db.ts — the rehearsal store this process uses, under K7_DATA_DIR; the calls store.ts makes are spread
// out as free functions, typed by collection off schema.ts. See ../docs/store.md.

import { env } from "./env.ts";
import type { Collection, FieldsOf } from "./schema.ts";
import { createSqlite, type DbRecord, type ListOptions } from "./sqlite.ts";

export const store = createSqlite(env.dataDir);

/** One row of `C`, its fields typed by the schema. */
export type Row<C extends Collection> = DbRecord<FieldsOf<C>>;

/** A filter: per field, the values it may hold. */
export type Filter<C extends Collection> = Partial<
  Record<keyof FieldsOf<C>, unknown[]>
>;

export const listRecords = <C extends Collection>(
  coll: C,
  filter?: Filter<C>,
  opts?: ListOptions,
): Row<C>[] => store.listRecords<FieldsOf<C>>(coll, filter, opts);

export const getRecord = <C extends Collection>(
  coll: C,
  id: string,
): Row<C> | null => store.getRecord<FieldsOf<C>>(coll, id);

export const addRecords = <C extends Collection>(
  coll: C,
  rows: (Partial<FieldsOf<C>> & { id?: string })[],
): { id: string }[] => store.addRecords(coll, rows);

export const patchRecord = <C extends Collection>(
  coll: C,
  id: string,
  fields: Partial<FieldsOf<C>>,
): void => store.patchRecord(coll, id, fields);

export const deleteRecords = (coll: Collection, ids: string[]): void =>
  store.deleteRecords(coll, ids);

export const { inTransaction } = store;
