import { defineEnv, port, z } from "@frediverse/env";
import { STUDIO_ORIGIN, serviceUrl } from "@studio/web-protocol/services";

// The development fallback — and the one value a production process must never sign with.
const DEV_SECRET = "dev-insecure-secret-change-me";

const raw = defineEnv(
  {
    PORT: port(8787),
    SESSION_SECRET: z.string().default(DEV_SECRET),
    API_TOKEN_SECRET: z.string().optional(),
    // Only needed to run migratePocketbaseData.ts once, copying the old Grist doc over.
    GRIST_API_URL: z.string().optional(),
    GRIST_DOC_ID: z.string().optional(),
    GRIST_API_KEY: z.string().optional(),
    POCKETBASE_URL: z.string().optional(),
    POCKETBASE_EMAIL: z.string().optional(),
    POCKETBASE_PASSWORD: z.string().optional(),
    POCKETBASE_TIMEOUT_MS: z.string().optional(),
    CACHE_MAX_GB: z.string().optional(),
    // Where a session's audio lives; a CHECKOUT is the exception — ../../docs/audio.md.
    MEDIATEK_URL: z.string().default(serviceUrl(STUDIO_ORIGIN, "pl8")),
    // Written by `npm run tokens`; without it the library refuses the push, never being open.
    MEDIATEK_TOKEN: z.string().optional(),
    // The OIDC groups whose members delete a public song, comma-separated; empty, nobody does.
    AUTH_ADMIN_GROUPS: z.string().default(""),
  },
  { service: "k7-backend" },
);

// RTC tickets and API tokens both derive from this secret: a deployment that missed it would sign with a value anyone can read here.
if (process.env.NODE_ENV === "production" && raw.SESSION_SECRET === DEV_SECRET)
  throw new Error(
    "SESSION_SECRET is unset — refusing to sign with the development secret in production",
  );

export const env = {
  port: raw.PORT,
  sessionSecret: raw.SESSION_SECRET,
  apiTokenSecret: raw.API_TOKEN_SECRET || `${raw.SESSION_SECRET}:api-token`,
  grist: {
    apiUrl: raw.GRIST_API_URL,
    docId: raw.GRIST_DOC_ID,
    apiKey: raw.GRIST_API_KEY,
  },
  pocketbase: {
    url: raw.POCKETBASE_URL,
    email: raw.POCKETBASE_EMAIL,
    password: raw.POCKETBASE_PASSWORD,
    // A stalled PocketBase must fail a request, not hang it and every one queued behind it (docs/pocketbase.md).
    timeoutMs: Number(raw.POCKETBASE_TIMEOUT_MS) || 15_000,
  },
  // The local audio cache holds copies the médiathèque can refill, trimmed oldest-first past this (docs/audit.md).
  cacheMaxBytes: (Number(raw.CACHE_MAX_GB) || 20) * 1024 ** 3,
  mediatek: {
    base: raw.MEDIATEK_URL,
    token: raw.MEDIATEK_TOKEN,
  },
  // Read as pl8 and z0 read the same variable — ../../docs/ownership.md.
  adminGroups: raw.AUTH_ADMIN_GROUPS.split(",")
    .map((g) => g.trim())
    .filter(Boolean),
};
