// This service's personal access tokens, and the middleware that accepts one in
// place of the session cookie. The scheme itself lives in @frediverse/oidc;
// here it is only bound to our API_TOKEN_SECRET.

import { apiTokenAuth } from "@frediverse/oidc/api-auth";
import { env } from "./env.ts";

export const { issueApiToken, verifyApiToken, bearerOrSession } = apiTokenAuth(
  env.apiTokenSecret,
);
