// This app's Grist document. The REST client lives in @frediverse/db-grist;
// here it is only bound to our GRIST_API_URL / GRIST_DOC_ID / GRIST_API_KEY
// and spread into the free functions the rest of the backend calls.

import { createGrist } from "@frediverse/db-grist";
import { env } from "./env.ts";

export type { GristColumn, GristRecord } from "@frediverse/db-grist";

export const grist = createGrist(env.grist);

export const {
  isConfigured,
  listRecords,
  addRecords,
  patchRecord,
  deleteRecords,
  uploadAttachment,
  downloadAttachment,
  listTables,
  createTable,
  listColumns,
  addColumns,
} = grist;
