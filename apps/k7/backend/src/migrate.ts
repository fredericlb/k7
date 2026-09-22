// Creates the PocketBase collections this app needs, if they don't already
// exist. Safe to run repeatedly — never drops or retypes a field, only adds
// what's missing. Usage:  npm run migrate

import { isConfigured, pocketbase } from "./pocketbase.ts";
import { SCHEMA } from "./schema.ts";

async function reconcile(
  name: string,
  fields: Parameters<typeof pocketbase.createCollection>[1],
) {
  const existing = await pocketbase.getCollection(name);
  if (!existing) {
    await pocketbase.createCollection(name, fields);
    console.log(`✓ created collection ${name}`);
    return;
  }
  const have = new Set(existing.fields.map((f) => f.name));
  const missing = fields.filter((f) => !have.has(f.name));
  if (missing.length) {
    await pocketbase.addMissingFields(existing.id, existing.fields, missing);
    console.log(
      `✓ ${name}: added fields ${missing.map((f) => f.name).join(", ")}`,
    );
  } else {
    console.log(`• ${name}: up to date`);
  }
}

async function migrate(): Promise<void> {
  if (!isConfigured()) {
    console.error(
      "✗ Pocketbase is not configured. Set POCKETBASE_URL, POCKETBASE_EMAIL and POCKETBASE_PASSWORD (see .env.example).",
    );
    process.exit(1);
  }

  for (const [name, fields] of Object.entries(SCHEMA)) {
    await reconcile(name, fields);
  }

  console.log("Migration complete.");
}

migrate().catch((err: unknown) => {
  console.error("Migration failed:", (err as Error).message);
  process.exit(1);
});
