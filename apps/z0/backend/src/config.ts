import { loadEnv } from "./env.ts";

// Two fields, and nothing host-shaped: this app is single-origin — see ../../docs/auth.md.
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

// From the environment; `node --env-file-if-exists` has already run, and real env wins.
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
