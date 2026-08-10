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
    // Where a session's audio LIVES, since it stopped being a Grist attachment. Defaulted
    // to the médiathèque's FIXED address — every studio service sits at a known path under
    // one origin, so there is nothing to choose and a deployment sets nothing.
    //
    // A CHECKOUT is the exception, and `npm run tokens` writes it: everything is behind
    // a private CA there, whose local CA node does not trust, so this
    // server-to-server call takes the loopback port instead (verified: fetching
    // https://st0.priv.frediver.se from node fails with UNABLE_TO_GET_ISSUER_CERT_LOCALLY, in the
    // browser beside it works). See docs/tokens.md.
    MEDIATEK_URL: z.string().default(serviceUrl(STUDIO_ORIGIN, "st0")),
    // Written by `npm run tokens` too — signed with the médiathèque's own API_TOKEN_SECRET,
    // which that script generates. Without it the library refuses the push: its routes are
    // behind a session or a bearer, never open.
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
