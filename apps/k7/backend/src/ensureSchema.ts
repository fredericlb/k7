// ensureSchema.ts — brings PocketBase up to schema.ts: creates missing collections, adds missing
// fields, never drops or retypes one. Run at every boot and by `npm run migrate`.
// What reads wrong: PocketBase silently drops a write to a field it lacks — ../../docs/pocketbase.md.

import { pocketbase } from "./pocketbase.ts";
import { SCHEMA } from "./schema.ts";

async function reconcile(
  name: string,
  fields: Parameters<typeof pocketbase.createCollection>[1],
  log: (line: string) => void,
) {
  const existing = await pocketbase.getCollection(name);
  if (!existing) {
    await pocketbase.createCollection(name, fields);
    log(`✓ created collection ${name}`);
    return;
  }
  const have = new Set(existing.fields.map((f) => f.name));
  const missing = fields.filter((f) => !have.has(f.name));
  if (missing.length) {
    await pocketbase.addMissingFields(existing.id, existing.fields, missing);
    log(`✓ ${name}: added fields ${missing.map((f) => f.name).join(", ")}`);
  } else {
    log(`• ${name}: up to date`);
  }
}

/** Create or extend every collection k7 needs; `log` hears one line per collection. */
export async function ensureSchema(
  log: (line: string) => void = () => {},
): Promise<void> {
  for (const [name, fields] of Object.entries(SCHEMA)) {
    await reconcile(name, fields, log);
  }

  // song_sheets needs Songs' PocketBase collection id, so it's created last.
  const songs = await pocketbase.getCollection("Songs");
  if (!songs) throw new Error("Songs collection missing after migration");
  await reconcile(
    "song_sheets",
    [
      {
        name: "song",
        type: "relation",
        required: true,
        collectionId: songs.id,
        cascadeDelete: true,
      },
      { name: "name", type: "text" },
      { name: "mime", type: "text" },
      { name: "file", type: "file", required: true },
    ],
    log,
  );
}
