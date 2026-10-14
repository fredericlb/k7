// db.ts — the rehearsal store this process uses, under K7_DATA_DIR; the calls store.ts makes are spread
// out as free functions. See ../docs/store.md.

import { env } from "./env.ts";
import { createSqlite } from "./sqlite.ts";

export const store = createSqlite(env.dataDir);

export const {
  listRecords,
  addRecords,
  patchRecord,
  deleteRecords,
  uploadAttachment,
  attachmentFile,
  deleteAttachment,
  isEmpty,
} = store;
