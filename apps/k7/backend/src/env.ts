import { defineEnv, port, z } from "@frediverse/env";

const raw = defineEnv(
  {
    PORT: port(8787),
    SESSION_SECRET: z.string().default("dev-insecure-secret-change-me"),
    API_TOKEN_SECRET: z.string().optional(),
    GRIST_API_URL: z.string().optional(),
    GRIST_DOC_ID: z.string().optional(),
    GRIST_API_KEY: z.string().optional(),
    // Where a session's audio LIVES, since it stopped being a Grist attachment. The dev
    // default reaches the médiathèque's backend DIRECTLY rather than through Caddy: this
    // is a server-to-server call, and https://studio.test carries Caddy's local CA, which
    // Node does not trust without being told to. A deployment sets its own.
    MEDIATEK_URL: z.string().default("http://127.0.0.1:8795"),
    // Minted by `POST /api/token` on the médiathèque, signed in. Without it the library
    // refuses the push — its routes are behind a session or a bearer, never open.
    MEDIATEK_TOKEN: z.string().optional(),
  },
  { service: "k7-backend" },
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
  mediatek: {
    base: raw.MEDIATEK_URL,
    token: raw.MEDIATEK_TOKEN,
  },
};
