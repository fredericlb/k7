// env.ts — the rehearsal server's configuration, read from k7-backend's section of env.yaml.
// It loads that section itself: k7's server.ts layers it into process.env only AFTER its imports ran.
// The media library is not configured here: the host hands its address and token to mountRehearsal.

import { homedir } from "node:os";
import { join } from "node:path";
import { defineEnv, z } from "@frediverse/env";

// The development fallback — and the one value a production process must never sign with.
const DEV_SECRET = "dev-insecure-secret-change-me";

const raw = defineEnv(
  {
    SESSION_SECRET: z.string().default(DEV_SECRET),
    // k7's own token secret, NOT k7's API_TOKEN_SECRET: the tokens saved in users' settings must keep verifying.
    K7_API_TOKEN_SECRET: z.string().optional(),
    // Set, and none of its rows here yet: the rows are copied out of that PocketBase once at boot — ../docs/store.md.
    POCKETBASE_URL: z.string().optional(),
    POCKETBASE_EMAIL: z.string().optional(),
    POCKETBASE_PASSWORD: z.string().optional(),
    CACHE_MAX_GB: z.string().optional(),
    // How many ffmpeg run at once across every account; the others queue — ../docs/audio.md.
    K7_FFMPEG_CONCURRENCY: z.string().optional(),
    // The local audio cache and the uploads in flight; under the home directory so a dev run needs no volume.
    K7_DATA_DIR: z.string().optional(),
    // `local` on a desktop or a phone: releases and pages are the paired server's, forwarded there — ../docs/publications.md.
    K7_INSTANCE: z.enum(["server", "local"]).default("server"),
    // The OIDC groups whose members delete a public song, comma-separated; empty, nobody does.
    AUTH_ADMIN_GROUPS: z.string().default(""),
  },
  { service: "k7-backend" },
);

// RTC tickets and API tokens both derive from this secret, and setupAuth does not refuse the default.
if (process.env.NODE_ENV === "production" && raw.SESSION_SECRET === DEV_SECRET)
  throw new Error(
    "SESSION_SECRET is unset — refusing to sign with the development secret in production",
  );

const dataDir = raw.K7_DATA_DIR || join(homedir(), ".studio", "k7");

// `pocketbase:8090` parses as a URL whose protocol is `pocketbase:`, which fetch refuses with a bare "fetch failed".
const withScheme = (url: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`;

export const env = {
  sessionSecret: raw.SESSION_SECRET,
  apiTokenSecret: raw.K7_API_TOKEN_SECRET || `${raw.SESSION_SECRET}:api-token`,
  dataDir,
  instance: raw.K7_INSTANCE,
  // Alone, without the credentials below, it imports nothing, and the boot says so.
  pocketbaseUrl: raw.POCKETBASE_URL || "",
  // The PocketBase the store is imported from once, when all three are set.
  pocketbase:
    raw.POCKETBASE_URL && raw.POCKETBASE_EMAIL && raw.POCKETBASE_PASSWORD
      ? {
          url: withScheme(raw.POCKETBASE_URL),
          email: raw.POCKETBASE_EMAIL,
          password: raw.POCKETBASE_PASSWORD,
        }
      : null,
  // The local audio cache holds copies the médiathèque can refill, trimmed oldest-first past this (../docs/audit.md).
  cacheMaxBytes: (Number(raw.CACHE_MAX_GB) || 20) * 1024 ** 3,
  ffmpegConcurrency: Math.max(
    1,
    Math.floor(Number(raw.K7_FFMPEG_CONCURRENCY)) || 2,
  ),
  // Read as k7's backend reads the same variable — ../docs/ownership.md.
  adminGroups: raw.AUTH_ADMIN_GROUPS.split(",")
    .map((g) => g.trim())
    .filter(Boolean),
};
