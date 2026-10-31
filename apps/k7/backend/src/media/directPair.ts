// directPair.ts — k7's choices for pairing without the browser (packages/file-hub/directPair.ts): which servers a
// machine trusts with its provider token, which clients' tokens a server takes, and how the provider is asked.
// What a reader gets wrong: no env, no route. A server takes tokens only once STUDIO_PAIR_CLIENTS names the clients,
// and a machine sends its token only to STUDIO_DIRECT_PAIR_SERVERS. See packages/file-hub/docs/syncRelay.md.

import type { AuthHandle } from "@frediverse/oidc";
import type {
  DirectPairServer,
  FileHubOptions,
  ProviderWord,
} from "@studio/file-hub";
import { normalizeServer } from "@studio/web-protocol/pairing";

type Provider = Pick<
  AuthHandle,
  "issuer" | "accessToken" | "userinfoFor" | "introspect"
>;

const list = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const text = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/** What the provider says of a token: introspection names its client when this server may ask, else UserInfo's `azp`. */
export async function providerWord(
  auth: Provider,
  token: string,
): Promise<ProviderWord | null> {
  const intro = await auth.introspect(token);
  if (intro && intro.active !== true) return null;
  const info = await auth.userinfoFor(token);
  const email = text(info?.email);
  const sub = text(info?.sub);
  if (!info || !email || !sub) return null;
  // An address the provider says it never checked is no proof of the account it names.
  if (info.email_verified === false) return null;
  if (intro && text(intro.sub) && intro.sub !== sub) return null;
  const clientId = intro
    ? text(intro.client_id)
    : (text(info.azp) ?? text(info.client_id));
  return { email, sub, clientId };
}

/** The direct pairing this process offers: a machine's side under STUDIO_LOCAL_USER, else a server's, or none. */
export function directPairFromEnv(
  auth: Provider,
  local: boolean,
  env: NodeJS.ProcessEnv = process.env,
): FileHubOptions["directPair"] {
  const issuer = auth.issuer;
  if (!issuer) return undefined;
  if (local) {
    const servers = list(env.STUDIO_DIRECT_PAIR_SERVERS)
      .map((s) => normalizeServer(s))
      .filter((s): s is string => !!s)
      .map((s) => new URL(s).host);
    if (!servers.length) return undefined;
    return {
      client: { issuer, servers, tokenOf: (req) => auth.accessToken(req) },
    };
  }
  const clients = list(env.STUDIO_PAIR_CLIENTS);
  if (!clients.length) return undefined;
  const server: DirectPairServer = {
    issuer,
    clients,
    verify: (token) => providerWord(auth, token),
  };
  return { server };
}
