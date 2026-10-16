// This service's personal access tokens, and the middleware that accepts one in place of the session
// cookie. The scheme lives in @frediverse/oidc; here it is bound to K7_API_TOKEN_SECRET and to a store
// under the data dir, which is what makes a token revocable (../docs/audio.md).

import { join } from "node:path";
import { apiTokenAuth, fileTokenStore } from "@frediverse/oidc/api-auth";
import { env } from "./env.ts";

export const { issueApiToken, listApiTokens, revokeApiToken, bearerOrSession } =
  apiTokenAuth(env.apiTokenSecret, {
    store: fileTokenStore(join(env.dataDir, "api-tokens.json")),
  });
