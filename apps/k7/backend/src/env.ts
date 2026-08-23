import { defineEnv, port, z } from "@frediverse/env";
import { STUDIO_ORIGIN, serviceUrl } from "@studio/web-protocol/services";

const raw = defineEnv(
  {
    PORT: port(8787),
    SESSION_SECRET: z.string().default("dev-insecure-secret-change-me"),
    API_TOKEN_SECRET: z.string().optional(),
    GRIST_API_URL: z.string().optional(),
    GRIST_DOC_ID: z.string().optional(),
    GRIST_API_KEY: z.string().optional(),
    // Where a session's audio lives; a CHECKOUT is the exception — ../../docs/audio.md.
    MEDIATEK_URL: z.string().default(serviceUrl(STUDIO_ORIGIN, "pl8")),
    // Written by `npm run tokens`; without it the library refuses the push, never being open.
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
