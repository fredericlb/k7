import { defineEnv, port, z } from "@frediverse/env";

// Comma-separated list -> trimmed, empties dropped, [] when unset (matches
// config.go's envList nil semantics for scopes/subjects/groups/origins).
const list = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== ""),
  );

/**
 * Every environment variable this backend reads, validated in one place.
 *
 * Deliberately a function, not a module-level constant: config is read *lazily*
 * (loadAppConfig() re-reads on each call, and the tests set process.env before
 * calling it). Snapshotting at import time would freeze the defaults in.
 *
 * Most vars default to "" rather than being required(), preserving the previous
 * behaviour where a missing value just leaves the feature unconfigured.
 *
 * Nothing here carries a frontend/backend URL: the SPAs and this backend share
 * one origin, so anything host-shaped (the OIDC redirect URI, the cookie scope)
 * is derived from the incoming request instead. See auth/oidc.ts.
 */
export function loadEnv() {
  return defineEnv(
    {
      GRIST_API_URL: z.string().default(""),
      GRIST_API_KEY: z.string().default(""),
      GRIST_DOC_ID: z.string().default(""),

      // Playlist mode reads public Spotify playlists for metadata + ISRC; the
      // audio always comes from Deezer, which needs no credentials. Unset
      // leaves Spotify playlists unsupported (Deezer ones keep working).
      SPOTIFY_CLIENT_ID: z.string().default(""),
      SPOTIFY_CLIENT_SECRET: z.string().default(""),

      // Read by @frediverse/oidc's own defineEnv, not here — listed so this
      // stays the one place that says what this service's section must hold.
      // OIDC_SCOPES is NOT among them any more: pl8 runs the flow, so it is
      // pl8 that asks the IdP for `groups`. See docs/auth.md.
      OIDC_ISSUER: z.string().default(""),
      OIDC_CLIENT_ID: z.string().default(""),
      OIDC_CLIENT_SECRET: z.string().default(""),
      // Signs the guest cookie AND verifies pl8's `studio.sid`. Must be
      // env.yaml `common`'s: do not give this service its own, or the account
      // login stops working with no error anywhere. See docs/auth.md.
      SESSION_SECRET: z.string().default(""),
      AUTH_ADMIN_GROUPS: list,

      // Named BACKEND_PORT (not PORT) so dev tooling's ambient PORT can't leak in.
      BACKEND_PORT: port(8080),
    },
    { service: "z0-backend" },
  );
}
