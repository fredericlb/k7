import { defineEnv, port, z } from "@frediverse/env";

// A comma-separated list, trimmed, empties dropped, [] when unset.
const list = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== ""),
  );

/** Every variable this backend reads; a FUNCTION, so a snapshot at import never freezes defaults. */
export function loadEnv() {
  return defineEnv(
    {
      GRIST_API_URL: z.string().default(""),
      GRIST_API_KEY: z.string().default(""),
      GRIST_DOC_ID: z.string().default(""),

      // Metadata and ISRC only; audio always comes from Deezer, which needs no credentials.
      SPOTIFY_CLIENT_ID: z.string().default(""),
      SPOTIFY_CLIENT_SECRET: z.string().default(""),

      // Read by @frediverse/oidc, listed here as the one place naming this section; no OIDC_SCOPES.
      OIDC_ISSUER: z.string().default(""),
      OIDC_CLIENT_ID: z.string().default(""),
      OIDC_CLIENT_SECRET: z.string().default(""),
      // Signs the guest cookie AND verifies pl8's; must be `common`'s — ../../docs/auth.md.
      SESSION_SECRET: z.string().default(""),
      AUTH_ADMIN_GROUPS: list,

      // Named BACKEND_PORT (not PORT) so dev tooling's ambient PORT can't leak in.
      BACKEND_PORT: port(8080),
    },
    { service: "z0-backend" },
  );
}
