// session.ts — a signed-in browser for the suite, without the identity provider.
// The cookie is signed with the instance's own SESSION_SECRET, read from this machine's env.yaml:
// it only works against an instance whose secret is on disk here, which is the point (docs/e2e.md).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadServiceEnv } from "@frediverse/env";
import { type SessionUser, sessionCookieHeader } from "@frediverse/oidc";

const COOKIE_NAME = "studio.sid";
// The backend's env.yaml section, the one whose SESSION_SECRET signs its cookies.
const SERVICE = "k7-backend";

/** A dedicated account, so the suite writes into a workspace of its own and never into a person's. */
export const E2E_USER: SessionUser = {
  sub: "e2e",
  name: "E2E",
  email: "e2e@st0.app",
  groups: [],
};

/** The env.yaml above this directory; a worktree lives under the checkout that holds it. */
function findEnvFile(): string {
  if (process.env.E2E_ENV_FILE) return resolve(process.env.E2E_ENV_FILE);
  for (let dir = resolve(import.meta.dirname); ; dir = dirname(dir)) {
    const candidate = join(dir, "env.yaml");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir)
      throw new Error("no env.yaml above e2e/ — set E2E_ENV_FILE");
  }
}

/** The cookies a browser context needs to be `user` on `baseURL`. */
export function sessionCookies(baseURL: string, user: SessionUser = E2E_USER) {
  const env = loadServiceEnv(SERVICE, findEnvFile());
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error(`env.yaml has no SESSION_SECRET for ${SERVICE}`);
  const header = sessionCookieHeader(user, { cookieName: COOKIE_NAME, secret });
  const { hostname } = new URL(baseURL);
  // Matches what the backend sets: Domain=COOKIE_DOMAIN with SameSite=None, host-only and Lax otherwise.
  const domain = env.COOKIE_DOMAIN || hostname;
  const sameSite = env.COOKIE_DOMAIN ? ("None" as const) : ("Lax" as const);
  return header.split("; ").map((pair) => {
    const [name, value] = pair.split("=", 2) as [string, string];
    return {
      name,
      value,
      domain,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite,
    };
  });
}
