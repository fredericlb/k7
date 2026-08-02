import { defineEnv, port, z } from "@frediverse/env";

const raw = defineEnv(
  {
    PORT: port(8787),
    SESSION_SECRET: z.string().default("dev-insecure-secret-change-me"),
    API_TOKEN_SECRET: z.string().optional(),
    GRIST_API_URL: z.string().optional(),
    GRIST_DOC_ID: z.string().optional(),
    GRIST_API_KEY: z.string().optional(),
  },
  { service: "radiok7-backend" },
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
};
