// env.ts — the rehearsal server's configuration, read from st0-backend's section of env.yaml.
// It loads that section itself: st0's server.ts layers it into process.env only AFTER its imports ran.
// The media library is not configured here: the host hands its address and token to mountRehearsal.

import { homedir } from "node:os";
import { join } from "node:path";
import { defineEnv, z } from "@frediverse/env";

// The development fallback — and the one value a production process must never sign with.
const DEV_SECRET = "dev-insecure-secret-change-me";

const raw = defineEnv(
  {
    SESSION_SECRET: z.string().default(DEV_SECRET),
    // k7's own token secret, NOT st0's API_TOKEN_SECRET: the tokens saved in users' settings must keep verifying.
    K7_API_TOKEN_SECRET: z.string().optional(),
    // Only needed to run migratePocketbaseData.ts once, copying the old Grist doc over.
    GRIST_API_URL: z.string().optional(),
    GRIST_DOC_ID: z.string().optional(),
    GRIST_API_KEY: z.string().optional(),
    POCKETBASE_URL: z.string().optional(),
    POCKETBASE_EMAIL: z.string().optional(),
    POCKETBASE_PASSWORD: z.string().optional(),
    POCKETBASE_TIMEOUT_MS: z.string().optional(),
    CACHE_MAX_GB: z.string().optional(),
    // The local audio cache and the uploads in flight; under the home directory so a dev run needs no volume.
    K7_DATA_DIR: z.string().optional(),
    // The OIDC groups whose members delete a public song, comma-separated; empty, nobody does.
    AUTH_ADMIN_GROUPS: z.string().default(""),
  },
  { service: "st0-backend" },
);

// RTC tickets and API tokens both derive from this secret, and setupAuth does not refuse the default.
if (process.env.NODE_ENV === "production" && raw.SESSION_SECRET === DEV_SECRET)
  throw new Error(
    "SESSION_SECRET is unset — refusing to sign with the development secret in production",
  );

export const env = {
  sessionSecret: raw.SESSION_SECRET,
  apiTokenSecret: raw.K7_API_TOKEN_SECRET || `${raw.SESSION_SECRET}:api-token`,
  dataDir: raw.K7_DATA_DIR || join(homedir(), ".studio", "k7"),
  grist: {
    apiUrl: raw.GRIST_API_URL,
    docId: raw.GRIST_DOC_ID,
    apiKey: raw.GRIST_API_KEY,
  },
  pocketbase: {
    url: raw.POCKETBASE_URL,
    email: raw.POCKETBASE_EMAIL,
    password: raw.POCKETBASE_PASSWORD,
    // A stalled PocketBase must fail a request, not hang it and every one queued behind it (../docs/pocketbase.md).
    timeoutMs: Number(raw.POCKETBASE_TIMEOUT_MS) || 15_000,
  },
  // The local audio cache holds copies the médiathèque can refill, trimmed oldest-first past this (../docs/audit.md).
  cacheMaxBytes: (Number(raw.CACHE_MAX_GB) || 20) * 1024 ** 3,
  // Read as st0 and z0 read the same variable — ../docs/ownership.md.
  adminGroups: raw.AUTH_ADMIN_GROUPS.split(",")
    .map((g) => g.trim())
    .filter(Boolean),
};
