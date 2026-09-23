// Creates the PocketBase collections this app needs, if they don't already
// exist. Safe to run repeatedly — never drops or retypes a field, only adds
// what's missing. The server does the same at boot. Usage:  npm run migrate

import { ensureSchema } from "./ensureSchema.ts";
import { isConfigured } from "./pocketbase.ts";

async function migrate(): Promise<void> {
  if (!isConfigured()) {
    console.error(
      "✗ Pocketbase is not configured. Set POCKETBASE_URL, POCKETBASE_EMAIL and POCKETBASE_PASSWORD (see .env.example).",
    );
    process.exit(1);
  }
  await ensureSchema(console.log);
  console.log("Migration complete.");
}

migrate().catch((err: unknown) => {
  console.error("Migration failed:", (err as Error).message);
  process.exit(1);
});
