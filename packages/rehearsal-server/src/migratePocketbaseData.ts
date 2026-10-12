// One-off copy of every row (and song sheet) from the old Grist doc into
// PocketBase. Run once, during the cutover maintenance window, after
// `npm run migrate` has created the PocketBase collections:
//
//   npm run migrate:data -w @studio/rehearsal-server
//
// Needs both GRIST_* and POCKETBASE_* env vars set. Refuses to run if any
// target collection already has rows, so it can't double-insert on a re-run.

import * as grist from "./grist.ts";
import {
  pocketbase,
  isConfigured as pocketbaseConfigured,
} from "./pocketbase.ts";
import { SCHEMA, TABLES } from "./schema.ts";

async function assertTargetsEmpty(): Promise<void> {
  for (const table of TABLES) {
    const rows = await pocketbase.listRecords(table);
    if (rows.length) {
      throw new Error(
        `${table} already has ${rows.length} row(s) in PocketBase — refusing to run again. Clear it first if this is intentional.`,
      );
    }
  }
}

// Only the columns the PocketBase schema declares — drops retired Grist
// columns (e.g. Songs.Favorite, migrated to SongFavorites long ago; SheetFiles).
function pickFields(
  table: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const known = new Set(SCHEMA[table].map((f) => f.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (known.has(k)) out[k] = v;
  }
  return out;
}

/** Table -> old Grist row id -> new PocketBase row id, for cross-table FK fixups if ever needed. */
async function copyTable(table: string): Promise<Map<number, string>> {
  const rows = await grist.listRecords(table);
  const idMap = new Map<number, string>();
  for (const row of rows) {
    const [{ id }] = await pocketbase.addRecords(table, [
      pickFields(table, row.fields as Record<string, unknown>),
    ]);
    idMap.set(row.id, id);
  }
  console.log(`✓ ${table}: copied ${rows.length} row(s)`);
  return idMap;
}

/** A Songs row's sheet attachments: download each from Grist, re-upload into song_sheets. */
async function copySheets(
  sheetMeta: unknown,
  newSongId: string,
): Promise<void> {
  let sheets: {
    id: string;
    attachmentId: string;
    name: string;
    mime: string;
  }[];
  try {
    sheets = JSON.parse(String(sheetMeta || "[]"));
  } catch {
    sheets = [];
  }
  if (!sheets.length) return;

  const migrated: {
    id: string;
    attachmentId: string;
    name: string;
    mime: string;
  }[] = [];
  for (const sheet of sheets) {
    const buffer = await grist.downloadAttachment(Number(sheet.attachmentId));
    const newId = await pocketbase.uploadAttachment(
      buffer,
      sheet.mime,
      sheet.name,
      newSongId,
    );
    migrated.push({
      id: newId,
      attachmentId: newId,
      name: sheet.name,
      mime: sheet.mime,
    });
  }
  await pocketbase.patchRecord("Songs", newSongId, {
    SheetMeta: JSON.stringify(migrated),
  });
  console.log(`  ↳ Songs/${newSongId}: copied ${migrated.length} sheet(s)`);
}

async function run(): Promise<void> {
  if (!grist.isConfigured() || !pocketbaseConfigured()) {
    console.error(
      "✗ Both GRIST_* and POCKETBASE_* env vars must be set to run this migration.",
    );
    process.exit(1);
  }

  await assertTargetsEmpty();

  const idMaps: Record<string, Map<number, string>> = {};
  // Order doesn't matter for correctness — every reference between these tables
  // is by app-generated Uid (a plain text field), never by row id.
  for (const table of TABLES) {
    idMaps[table] = await copyTable(table);
  }

  const songRows = await grist.listRecords("Songs");
  for (const row of songRows) {
    const newSongId = idMaps.Songs.get(row.id);
    if (newSongId) await copySheets(row.fields.SheetMeta, newSongId);
  }

  console.log(
    "Data migration complete. Verify counts, then decommission Grist.",
  );
}

run().catch((err: unknown) => {
  console.error("Data migration failed:", (err as Error).message);
  process.exit(1);
});
