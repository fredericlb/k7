import { loadEnv } from "./env.ts";

// What the shared auth package can't decide for us.
//
// The OIDC flow lives in @frediverse/oidc (setupAuth), which reads OIDC_ISSUER
// / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / SESSION_SECRET from this service's
// env section itself — so those aren't carried here any more. What's left:
//   scopes        passed through to setupAuth (this IdP also sends `groups`)
//   adminGroups   which groups are privileged is per-app authorization policy
//   sessionSecret needed to decode the session on a WebSocket upgrade, which is
//                 a raw http event and so never sees req.session (see ws.ts)
//
// Note what is NOT here either: the OIDC redirect URI, the cookie's Domain and
// Secure flag, and the allowed return origins. Those are all host-shaped, and
// the app is single-origin — the SPAs and this backend answer on the same host
// — so they're derived per request from the public URL the client actually used
// (X-Forwarded-Proto / X-Forwarded-Host, honoured via `trust proxy`).
export interface AuthConfig {
  scopes: string[];
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
  const scopes = env.OIDC_SCOPES;

  return {
    grist: {
      url: env.GRIST_API_URL,
      apiKey: env.GRIST_API_KEY,
      docId: env.GRIST_DOC_ID,
    },
    auth: {
      scopes: scopes.length > 0 ? scopes : ["openid", "profile", "email"],
      sessionSecret: env.SESSION_SECRET,
      adminGroups: env.AUTH_ADMIN_GROUPS,
    },
  };
}
