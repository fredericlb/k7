import { loadEnv } from "./env.ts";

// What the shared auth package can't decide for us.
//
// There is no OIDC flow here at all any more — pl8 owns the account login for
// the whole origin, because only the prefixless callback is registered (see
// docs/auth.md). So `scopes` is gone with it: nothing in this process asks the
// IdP for anything. What's left:
//   adminGroups   which groups are privileged is per-app authorization policy
//   sessionSecret needed to decode a session OUTSIDE the middleware chain: on a
//                 WebSocket upgrade, which never sees req.session (ws.ts), and
//                 for pl8's `studio.sid`, which this backend reads but never
//                 writes. It must be env.yaml `common`'s — the same constraint
//                 l8, m9 and k7 are under. See docs/auth.md.
//
// Note what is NOT here either: the OIDC redirect URI, the cookie's Domain and
// Secure flag, and the allowed return origins. Those are all host-shaped, and
// the app is single-origin — the SPAs and this backend answer on the same host
// — so they're derived per request from the public URL the client actually used
// (X-Forwarded-Proto / X-Forwarded-Host, honoured via `trust proxy`).
export interface AuthConfig {
  sessionSecret: string;
  adminGroups: string[];
}

// Connection details for the self-hosted Grist backing sessions/songs/tracks.
export interface GristConfig {
  url: string;
  apiKey: string;
  docId: string;
}

export interface AppConfig {
  auth: AuthConfig;
  grist: GristConfig;
}

// Populate the app config from environment variables. The .env file is loaded by
// `node --env-file-if-exists` before this runs (real env wins, matching
// config.go's loadDotEnv). Mirrors config.go's loadAppConfig.
export function loadAppConfig(): AppConfig {
  const env = loadEnv();

  return {
    grist: {
      url: env.GRIST_API_URL,
      apiKey: env.GRIST_API_KEY,
      docId: env.GRIST_DOC_ID,
    },
    auth: {
      sessionSecret: env.SESSION_SECRET,
      adminGroups: env.AUTH_ADMIN_GROUPS,
    },
  };
}
